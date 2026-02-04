# Example Plans

This folder contains example Oracle execution plans that appear in the "Load Example" dropdown menu.

## Adding New Examples

To add a new example, simply create a new `.txt` file in this folder following the naming convention below. **No code changes required!**

### File Naming Convention

```
NN-category-Display Name.txt
```

- **NN**: Two-digit sort order (e.g., `01`, `02`, `03`)
- **category**: Either `dbms_xplan` or `sql_monitor`
- **Display Name**: The name shown in the dropdown menu

### Examples

- `01-dbms_xplan-Simple Plan.txt` → Shows as "Simple Plan" under DBMS_XPLAN
- `02-dbms_xplan-Complex Plan.txt` → Shows as "Complex Plan" under DBMS_XPLAN
- `03-sql_monitor-SQL Monitor.txt` → Shows as "SQL Monitor" under SQL Monitor

### File Content

The file content should be the raw Oracle execution plan output:
- For DBMS_XPLAN: Copy the output from `DBMS_XPLAN.DISPLAY` or similar
- For SQL Monitor: Copy the text or XML output from `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR`

The parser will auto-detect the format based on the content.
