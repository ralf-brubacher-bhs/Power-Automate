# Planificacion
## Formato resaltado basado en Due
El flujo está funcionando. Quiero que la tabla de excel tenga color condicional, toda la fila, basado en el valor de una de las columnas (Due). Cuando el flujo pisa el template, se me borra el formato condicional. Hay una alternativa?

Solución Claude:
## Why the rule disappears

A conditional formatting (CF) rule is attached to a specific cell range, such as `F2:F120`. Your script calls `deleteRowsAt` to clear the table, which deletes the cells the rule points to. Once every data row is gone, the rule's range is empty and Excel drops it. Whether `addRows` later extends a surviving rule to the new rows isn't documented as guaranteed, so you shouldn't rely on the template's rule.

## Recommended approach: let the script own the formatting

After writing the data, have the script:

1. Clear any conditional formats on the target range.
2. Add the rules again.

Benefits:

- **Deterministic:** the result doesn't depend on what Excel kept or dropped.
- **Idempotent:** clearing first means reruns never pile up duplicate rules.
- **Versioned:** the rules live in code, next to the data logic, not hidden in the template.

Also remove the manual rule from the template, so there is only one source of truth.

### Code to add to the script

**1. New parameters on `main`** (they have defaults, so existing calls still work):

```typescript
function main(
  workbook: ExcelScript.Workbook,
  rowsJson: string,
  tableName: string = "tblNOA",
  dueColumnName: string = "due",
  formatScope: "cell" | "row" = "cell"   // "cell" = only the due cell, "row" = whole table row
): Result {
```

**2. Call it between step 6 (batch write) and step 7 (final check).** It sits after the early `return` for zero rows, so it never runs on an empty table:

```typescript
  // 6b) Re-apply conditional formatting (owned by the script, not the template)
  applyDueFormatting(table, dueColumnName, formatScope);
```

**3. Helper functions** (place them below `main`):

```typescript
const RED = "#C00000";
const ORANGE = "#ED7D31";

/**
 * Applies the "due" conditional formatting rules:
 *   due < 0  → bold red
 *   due = 0  → bold orange
 *   otherwise → unchanged
 * Clears previous rules on the target range first, so it is safe to rerun.
 */
function applyDueFormatting(
  table: ExcelScript.Table,
  dueColumnName: string,
  scope: "cell" | "row"
): void {
  const column = table.getColumns().find(
    c => c.getName().trim().toLowerCase() === dueColumnName.trim().toLowerCase()
  );
  if (!column) {
    throw new Error(`Column '${dueColumnName}' not found in table '${table.getName()}'.`);
  }

  const dueRange = column.getRangeBetweenHeaderAndTotal();
  const target = scope === "row" ? table.getRangeBetweenHeaderAndTotal() : dueRange;

  // Idempotency: remove any existing rules on the target range
  target.clearAllConditionalFormats();

  if (scope === "cell") {
    addCellValueRule(target, ExcelScript.ConditionalCellValueOperator.lessThan, RED);
    addCellValueRule(target, ExcelScript.ConditionalCellValueOperator.equalTo, ORANGE);
  } else {
    // Absolute column, relative row, anchored on the first due cell, e.g. "$F2"
    const firstCell = dueRange.getCell(0, 0).getAddress().split("!").pop()!; // "F2"
    const ref = "$" + firstCell;
    addFormulaRule(target, `=AND(ISNUMBER(${ref}),${ref}<0)`, RED);
    addFormulaRule(target, `=AND(ISNUMBER(${ref}),${ref}=0)`, ORANGE);
  }
}

function addCellValueRule(
  range: ExcelScript.Range,
  operator: ExcelScript.ConditionalCellValueOperator,
  color: string
): void {
  const cf = range
    .addConditionalFormat(ExcelScript.ConditionalFormatType.cellValue)
    .getCellValue();
  cf.setRule({ formula1: "0", operator: operator });
  const font = cf.getFormat().getFont();
  font.setColor(color);
  font.setBold(true);
}

function addFormulaRule(range: ExcelScript.Range, formula: string, color: string): void {
  const cf = range
    .addConditionalFormat(ExcelScript.ConditionalFormatType.custom)
    .getCustom();
  cf.getRule().setFormula(formula);
  const font = cf.getFormat().getFont();
  font.setColor(color);
  font.setBold(true);
}
```

### Notes

- **Formula syntax:** formulas passed through the API use en-US syntax (comma separators, English function names), whatever your Excel locale is. Write `AND(...,...)`, not `Y(...;...)`.
- **Data type:** the rules compare numbers. If Power BI returns `due` as a string (e.g. `"-3"`), comparisons fail silently. Make sure the measure or column is numeric, or convert it in `toExcel`.
- **Blank cells in `cell` mode:** a "Cell value equal to 0" rule treats blank cells as 0. That's harmless here, because bold orange on an empty cell is invisible. The `row` variant guards against blanks explicitly with `ISNUMBER`.
- **Other rules get cleared too:** `clearAllConditionalFormats()` removes every rule on the target range. In `row` mode, that's the whole table body. If the template has other CF rules you want to keep, apply them in the script as well.
- **Refresh the flow action:** Power Automate caches the script's parameters. Re-select the script in the *Run script from SharePoint library* action so the new optional fields show up.

### Lighter alternative (with trade-offs)

You can define the rule in the template on the entire worksheet column (for example `$F:$F`) instead of on the table range. A whole-column range survives row deletion, so the rule persists. The downside is that it breaks silently if someone moves or inserts columns, and it applies outside the table too. The script-based approach is more robust.

Sources:
- [Office Scripts sample: Conditional formatting](https://learn.microsoft.com/office/dev/scripts/resources/samples/conditional-formatting)
- [ExcelScript.ConditionalCellValue interface](https://learn.microsoft.com/javascript/api/office-scripts/excelscript/excelscript.conditionalcellvalue)
- [ExcelScript.Range – addConditionalFormat / clearAllConditionalFormats](https://learn.microsoft.com/javascript/api/office-scripts/excelscript/excelscript.range)