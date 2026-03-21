import { describe, it, expect } from 'vitest';
import { xbiParser } from '../xbiParser';
import { detectFormat } from '../index';

const SAMPLE_XBI_OUTPUT = `-- xbi.sql: eXplain Better v1.01 for sql_id=czxpthmzk8nnd child=0 - by Tanel Poder (https://blog.tanelpoder.com)

         SQL_ID         CHLD ADDRESS          Plan Hash Value First Load Time
-------- ------------- ----- ---------------- --------------- ------
Cursor:  czxpthmzk8nnd     0 000000049451AFB8      2501019660 Statement first parsed at: 2022-03-17/01:21:20 - 1234 seconds ago

 Pred    Op  Par.  #Sib                                              Query Block             ms spent in Consistent  Rowsource  Real #rows     Est. rows      Opt. Card.    Current   Physical   Physical        Memory Workarea        Optimizer
 #Col    ID    ID  ling Row Source                                   name                 this operation       gets     starts    returned         total     misestimate       gets  read blks write blks     used (MB) Passes               Cost
----- ----- ----- ----- -------------------------------------------- -------------------- -------------- ---------- ---------- ----------- ------------- --------------- ---------- ---------- ---------- ------------- ------------- -----------
          0             SELECT STATEMENT                             >>> Plan totals >>>        3,220.09     125211          1          20                                        0       9391          0                                  121263
          1     0     1  SORT ORDER BY                               SEL$1                           .07          0          1          20        114030           5701x          0          0          0           .00 OPTIMAL            121263
          2     1     1   HASH GROUP BY                                                             3.89          0          1         245        114030            465x          0          0          0          5.54 OPTIMAL            121263
    A     3     2     1    HASH JOIN                                                               28.78          0          1        9056        114030             13x          0          0          0          1.63 OPTIMAL            117113
    F     4     3     1     TABLE ACCESS FULL [DATE_DIM]             SEL$1                          4.02       1456          1        6000          6000              1x          0          0          0                                     229
          5     3     2     NESTED LOOPS                                                           39.05          0          1      112576        114030              1x          0          0          0                                  116883
          6     5     1      NESTED LOOPS                                                          13.67          0          1      112576        114345              1x          0          0          0                                  116883
    F     7     6     1       TABLE ACCESS FULL [ITEM]               SEL$1                         31.71      10374          1         160           165              1x          0          0          0                                    1670
  A#1     8     6     2       INDEX RANGE SCAN [STORE_SALES_PK_IDX]  SEL$1                         43.44        866        160      112576        110880             -1x          0         77          0                                       5
          9     5     2      TABLE ACCESS BY GLOBAL INDEX ROWID      SEL$1                      3,055.46     112515     112576      112576      78015168            693x          0       9314          0                                     698

   Op Query Block
   ID name                  Predicate Information (identified by operation id):
----- -------------------- - ----------------------------------------------------------------------------------------------------
    3                       - access("SS"."SS_SOLD_DATE_SK"="D"."D_DATE_SK")
    4  SEL$1                - filter("D"."D_YEAR" BETWEEN 1998 AND 2001)
    7  SEL$1                - filter("I"."I_MANUFACT_ID" BETWEEN 738 AND 742)
    8  SEL$1                - access("SS"."SS_ITEM_SK"="I"."I_ITEM_SK")
`;

describe('xbiParser', () => {
  describe('canParse', () => {
    it('detects xbi output by banner', () => {
      expect(xbiParser.canParse(SAMPLE_XBI_OUTPUT)).toBe(true);
    });

    it('detects xbi output by Row Source header and separator', () => {
      const noBanner = SAMPLE_XBI_OUTPUT.replace(/.*eXplain Better.*\n/, '');
      expect(xbiParser.canParse(noBanner)).toBe(true);
    });

    it('does not match DBMS_XPLAN output', () => {
      const dbmsXplan = `
Plan hash value: 1234567890

| Id  | Operation            | Name | Rows  | Bytes | Cost (%CPU)|
|   0 | SELECT STATEMENT     |      |     1 |    10 |     5   (0)|
`;
      expect(xbiParser.canParse(dbmsXplan)).toBe(false);
    });

    it('does not match empty input', () => {
      expect(xbiParser.canParse('')).toBe(false);
    });
  });

  describe('parse', () => {
    it('parses all plan nodes', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.allNodes).toHaveLength(10);
      expect(plan.rootNode).not.toBeNull();
      expect(plan.rootNode!.id).toBe(0);
    });

    it('extracts sql_id from banner', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.sqlId).toBe('czxpthmzk8nnd');
    });

    it('extracts plan hash value', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.planHashValue).toBe('2501019660');
    });

    it('sets source to xbi', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.source).toBe('xbi');
    });

    it('detects actual stats', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.hasActualStats).toBe(true);
    });

    it('parses root node (SELECT STATEMENT) with total time', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      const root = plan.rootNode!;
      expect(root.operation).toBe('SELECT STATEMENT');
      expect(root.actualTime).toBeCloseTo(3220.09, 1);
      expect(root.actualRows).toBe(20);
      expect(root.starts).toBe(1);
      expect(root.cost).toBe(121263);
    });

    it('parses operations with object names in brackets', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      const node4 = plan.allNodes.find(n => n.id === 4)!;
      expect(node4.operation).toBe('TABLE ACCESS FULL');
      expect(node4.objectName).toBe('DATE_DIM');

      const node8 = plan.allNodes.find(n => n.id === 8)!;
      expect(node8.operation).toBe('INDEX RANGE SCAN');
      expect(node8.objectName).toBe('STORE_SALES_PK_IDX');
    });

    it('builds correct parent-child tree using explicit parent IDs', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      const root = plan.rootNode!;

      // Root (0) -> SORT ORDER BY (1)
      expect(root.children).toHaveLength(1);
      expect(root.children[0].id).toBe(1);

      // SORT ORDER BY (1) -> HASH GROUP BY (2)
      expect(root.children[0].children).toHaveLength(1);
      expect(root.children[0].children[0].id).toBe(2);

      // HASH JOIN (3) has two children: TABLE ACCESS FULL (4) and NESTED LOOPS (5)
      const hashJoin = plan.allNodes.find(n => n.id === 3)!;
      expect(hashJoin.children).toHaveLength(2);
      expect(hashJoin.children[0].id).toBe(4);
      expect(hashJoin.children[1].id).toBe(5);
    });

    it('parses actual runtime statistics', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      // Node 9: TABLE ACCESS BY GLOBAL INDEX ROWID
      const node9 = plan.allNodes.find(n => n.id === 9)!;
      expect(node9.actualTime).toBeCloseTo(3055.46, 1);
      expect(node9.actualRows).toBe(112576);
      expect(node9.starts).toBe(112576);
      expect(node9.physicalReads).toBe(9314);
      expect(node9.cost).toBe(698);
    });

    it('derives per-start estimated rows from total', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      // Node 4: DATE_DIM - estRowsTotal=6000, starts=1 -> rows=6000
      const node4 = plan.allNodes.find(n => n.id === 4)!;
      expect(node4.rows).toBe(6000);

      // Node 8: INDEX RANGE SCAN - estRowsTotal=110880, starts=160 -> rows=693
      const node8 = plan.allNodes.find(n => n.id === 8)!;
      expect(node8.rows).toBe(Math.round(110880 / 160));
    });

    it('computes logical reads from consistent + current gets', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      // Node 0: consistentGets=125211, currentGets=0
      const root = plan.rootNode!;
      expect(root.logicalReads).toBe(125211);

      // Node 7: consistentGets=10374, currentGets=0
      const node7 = plan.allNodes.find(n => n.id === 7)!;
      expect(node7.logicalReads).toBe(10374);
    });

    it('converts memory from MB to bytes', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      // Node 2: memory=5.54 MB
      const node2 = plan.allNodes.find(n => n.id === 2)!;
      expect(node2.memoryUsed).toBe(Math.round(5.54 * 1048576));
    });

    it('parses query block names', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      const node1 = plan.allNodes.find(n => n.id === 1)!;
      expect(node1.queryBlock).toBe('SEL$1');

      // Root node should NOT have ">>> Plan totals >>>" as query block
      const root = plan.rootNode!;
      expect(root.queryBlock).toBeUndefined();
    });

    it('parses predicates', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      const node3 = plan.allNodes.find(n => n.id === 3)!;
      expect(node3.accessPredicates).toContain('"SS"."SS_SOLD_DATE_SK"="D"."D_DATE_SK"');

      const node4 = plan.allNodes.find(n => n.id === 4)!;
      expect(node4.filterPredicates).toContain('"D"."D_YEAR" BETWEEN 1998 AND 2001');

      const node7 = plan.allNodes.find(n => n.id === 7)!;
      expect(node7.filterPredicates).toContain('"I"."I_MANUFACT_ID" BETWEEN 738 AND 742');

      const node8 = plan.allNodes.find(n => n.id === 8)!;
      expect(node8.accessPredicates).toContain('"SS"."SS_ITEM_SK"="I"."I_ITEM_SK"');
    });

    it('computes activity percent', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);

      // Node 9 has 3055.46ms / 3220.09ms total = ~94.9%
      const node9 = plan.allNodes.find(n => n.id === 9)!;
      expect(node9.activityPercent).toBeCloseTo(94.9, 0);
    });

    it('sets total elapsed time from root', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.totalElapsedTime).toBeCloseTo(3220.09, 1);
    });

    it('computes maxActualRows and maxStarts', () => {
      const plan = xbiParser.parse(SAMPLE_XBI_OUTPUT);
      expect(plan.maxActualRows).toBe(112576);
      expect(plan.maxStarts).toBe(112576);
    });
  });

  describe('format detection', () => {
    it('detects xbi format via detectFormat', () => {
      expect(detectFormat(SAMPLE_XBI_OUTPUT)).toBe('xbi');
    });
  });

  describe('complex plan (temp table transformation)', () => {
    const COMPLEX_XBI = `-- xbi.sql: eXplain Better v1.01 for sql_id=bpt7vm7wbsn42 child=0 - by Tanel Poder (https://blog.tanelpoder.com)

         SQL_ID         CHLD ADDRESS          Plan Hash Value First Load Time
-------- ------------- ----- ---------------- --------------- ------
Cursor:  bpt7vm7wbsn42     0 00000004B23CC150      3847201918 Statement first parsed at: 2022-03-17/01:35:44 - 890 seconds ago

 Pred    Op  Par.  #Sib                                           Query Block             ms spent in Consistent  Rowsource  Real #rows     Est. rows      Opt. Card.    Current   Physical   Physical        Memory Workarea        Optimizer
 #Col    ID    ID  ling Row Source                                name                 this operation       gets     starts    returned         total     misestimate       gets  read blks write blks     used (MB) Passes               Cost
----- ----- ----- ----- ----------------------------------------- -------------------- -------------- ---------- ---------- ----------- ------------- --------------- ---------- ---------- ---------- ------------- ------------- -----------
          0             SELECT STATEMENT                          >>> Plan totals >>>        2,901.67     170271          1          20                                        2     153524          0                                   44144
          1     0     1  TEMP TABLE TRANSFORMATION                SEL$2980E977                    .06          0          1          20                                        1          0          0
          2     1     1   LOAD AS SELECT                           SEL$F6D5D92C                  22.31          0          1           0                                        1          0          0           .00 OPTIMAL
          3     2     1    HASH GROUP BY                                                       246.10          0          1       64004       2096755             33x          0          0          0         75.58 OPTIMAL             37556
    A     4     3     1     HASH JOIN                                                          253.99          1          1     2057505       2096755              1x          0          0          0          1.69 OPTIMAL             23776
          5     4     1      VIEW [VW_GBF_7]                      SEL$7502D05D                    .02          0          1         365           365              1x          0          0          0                                     229
    F     6     5     1       TABLE ACCESS FULL [DATE_DIM]        SEL$7502D05D                   4.35       1456          1         365           365              1x          0          0          0                                     229
          7     4     2      PARTITION RANGE ALL                                                10.82          0          1    11500560      11500560              1x          0          0          0                                   23491
          8     7     1       TABLE ACCESS FULL [STORE_RETURNS]   SEL$F6D5D92C               2,254.94     153827         22    11500560     253012320             22x          0     153524          0                                   23491
          9     1     2   SORT ORDER BY                                                          5.03          0          1          20        100470           5024x          0          0          0           .84 OPTIMAL              6588
    A    10     9     1    HASH JOIN                                                             7.16          1          1       25597        100470              4x          0          0          0          1.22 OPTIMAL              5271
    F    11    10     1     TABLE ACCESS FULL [STORE]             SEL$2980E977                    .04         18          1          12            12              1x          0          0          0                                      20
    A    12    10     2     HASH JOIN                                                           31.20          1          1       25597        104838              4x          0          0          0          4.00 OPTIMAL              5251
   FA    13    12     1      HASH JOIN                                                           4.19          1          1       25597        104838              4x          0          0          0          1.21 OPTIMAL              2535
         14    13     1       VIEW [VW_SQ_1]                      SEL$8F9407EC                    .02          0          1          11            11              1x          0          0          0                                    1311
         15    14     1        HASH GROUP BY                      SEL$8F9407EC                   6.07          0          1          11            11              1x          0          0          0          1.01 OPTIMAL              1311
         16    15     1         VIEW                              SEL$D67CB2D2                    .05          0          1       64004       2096755             33x          0          0          0                                    1213
         17    16     1          TABLE ACCESS FULL [SYS_TEMP]     SEL$D67CB2D2                   1.86          0          1       64004       2096755             33x          0          0          0                                    1213
         18    13     2       VIEW                                SEL$D67CB2D3                    .05          0          1       64004       2096755             33x          0          0          0                                    1213
         19    18     1        TABLE ACCESS FULL [SYS_TEMP]       SEL$D67CB2D3                   1.79          0          1       64004       2096755             33x          0          0          0                                    1213
         20    12     2      TABLE ACCESS FULL [CUSTOMER]         SEL$2980E977                  51.62      14966          1      709015        709015              1x          0          0          0                                    2284

   Op Query Block
   ID name                  Predicate Information (identified by operation id):
----- -------------------- - ----------------------------------------------------------------------------------------------------
    4                       - access("ITEM_SK"="SR_ITEM_SK" AND "D_DATE_SK"="SR_RETURNED_DATE_SK")
    6  SEL$7502D05D         - filter("D_YEAR"=2000)
    8  SEL$F6D5D92C         - filter(INTERNAL_FUNCTION("SR_RETURN_AMT")>10000)
   10                       - access("STORE_SK"="S_STORE_SK")
   11  SEL$2980E977         - filter("S_STATE"='TN')
   12                       - access("C_CUSTOMER_SK"="CUSTOMER_SK")
   13                       - filter("CUST_CNT"<=20)
   13                       - access("ITEM_SK"="SR_ITEM_SK")
   20  SEL$2980E977         - filter(LNNVL("C_CUSTOMER_SK"<>"CUSTOMER_SK"))
`;

    it('parses all 21 nodes', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      expect(plan.allNodes).toHaveLength(21);
    });

    it('extracts metadata', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      expect(plan.sqlId).toBe('bpt7vm7wbsn42');
      expect(plan.planHashValue).toBe('3847201918');
    });

    it('builds TEMP TABLE TRANSFORMATION tree correctly', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      // Node 1 (TEMP TABLE TRANSFORMATION) has two children: LOAD AS SELECT (2) and SORT ORDER BY (9)
      const node1 = plan.allNodes.find(n => n.id === 1)!;
      expect(node1.children).toHaveLength(2);
      expect(node1.children[0].id).toBe(2);
      expect(node1.children[1].id).toBe(9);
    });

    it('parses node with both access and filter predicates (FA)', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      const node13 = plan.allNodes.find(n => n.id === 13)!;
      expect(node13.accessPredicates).toContain('"ITEM_SK"="SR_ITEM_SK"');
      expect(node13.filterPredicates).toContain('"CUST_CNT"<=20');
    });

    it('identifies hotspot node (STORE_RETURNS full scan)', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      const node8 = plan.allNodes.find(n => n.id === 8)!;
      expect(node8.objectName).toBe('STORE_RETURNS');
      expect(node8.actualTime).toBeCloseTo(2254.94, 1);
      expect(node8.physicalReads).toBe(153524);
    });

    it('handles partition scan with multiple starts', () => {
      const plan = xbiParser.parse(COMPLEX_XBI);
      const node8 = plan.allNodes.find(n => n.id === 8)!;
      expect(node8.starts).toBe(22);
      expect(node8.actualRows).toBe(11500560);
      // Est. rows total = 253012320, starts = 22 -> per-start = 11500560
      expect(node8.rows).toBe(Math.round(253012320 / 22));
    });
  });

  describe('plan without banner', () => {
    it('parses xbi output without banner and cursor metadata', () => {
      const planOnly = ` Pred    Op  Par.  #Sib                                              Query Block             ms spent in Consistent  Rowsource  Real #rows     Est. rows      Opt. Card.    Current   Physical   Physical        Memory Workarea        Optimizer
 #Col    ID    ID  ling Row Source                                   name                 this operation       gets     starts    returned         total     misestimate       gets  read blks write blks     used (MB) Passes               Cost
----- ----- ----- ----- -------------------------------------------- -------------------- -------------- ---------- ---------- ----------- ------------- --------------- ---------- ---------- ---------- ------------- ------------- -----------
          0             SELECT STATEMENT                             >>> Plan totals >>>          100.00        500          1          10                                        0        100          0                                    5000
          1     0     1  TABLE ACCESS FULL [EMPLOYEES]               SEL$1                        100.00        500          1          10          10              1x          0        100          0                                    5000
`;
      expect(xbiParser.canParse(planOnly)).toBe(true);
      const plan = xbiParser.parse(planOnly);
      expect(plan.allNodes).toHaveLength(2);
      expect(plan.rootNode!.children).toHaveLength(1);
      expect(plan.allNodes[1].objectName).toBe('EMPLOYEES');
      expect(plan.source).toBe('xbi');
    });
  });
});
