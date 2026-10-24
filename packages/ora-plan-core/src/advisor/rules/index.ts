import type { AdvisorRule } from '../types.ts';
import { implicitConversionRule } from './implicitConversion.ts';
import { nestedLoopVolumeRule } from './nestedLoopVolume.ts';
import { mergeJoinCartesianRule } from './mergeJoinCartesian.ts';
import { selectiveFullScanRule } from './selectiveFullScan.ts';
import { unusedIndexRule } from './unusedIndex.ts';
import { cardinalityMismatchRule } from './cardinalityMismatch.ts';
import { spillToDiskRule } from './spillToDisk.ts';
import { statsIssuesRule } from './statsIssues.ts';
import { partitionPruningRule } from './partitionPruning.ts';
import { parallelSignalsRule } from './parallelSignals.ts';
import { perRowReexecutionRule } from './perRowReexecution.ts';
import { indexRowsDiscardedRule } from './indexRowsDiscarded.ts';
import { bufferEfficiencyRule } from './bufferEfficiency.ts';
import { planNotesRule } from './planNotes.ts';
import { functionOnIndexedColumnRule } from './functionOnIndexedColumn.ts';
import { hashJoinBuildSideRule } from './hashJoinBuildSide.ts';
import { pxSkewRule } from './pxSkew.ts';

export const ALL_RULES: AdvisorRule[] = [
  implicitConversionRule,
  nestedLoopVolumeRule,
  mergeJoinCartesianRule,
  selectiveFullScanRule,
  unusedIndexRule,
  cardinalityMismatchRule,
  spillToDiskRule,
  statsIssuesRule,
  partitionPruningRule,
  parallelSignalsRule,
  perRowReexecutionRule,
  indexRowsDiscardedRule,
  bufferEfficiencyRule,
  planNotesRule,
  functionOnIndexedColumnRule,
  hashJoinBuildSideRule,
  pxSkewRule,
];

export {
  implicitConversionRule,
  nestedLoopVolumeRule,
  mergeJoinCartesianRule,
  selectiveFullScanRule,
  unusedIndexRule,
  cardinalityMismatchRule,
  spillToDiskRule,
  statsIssuesRule,
  partitionPruningRule,
  parallelSignalsRule,
  perRowReexecutionRule,
  indexRowsDiscardedRule,
  bufferEfficiencyRule,
  planNotesRule,
  functionOnIndexedColumnRule,
  hashJoinBuildSideRule,
  pxSkewRule,
};
