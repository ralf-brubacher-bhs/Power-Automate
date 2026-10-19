function main(
    workbook: ExcelScript.Workbook,
    records: string,
    dueColumnName: string = "Due",
    formatScope: "cell" | "row" = "cell"   // "cell" = only the Due cell, "row" = whole row
) {

    const table = workbook.getTable("tblNOA");
    if (!table) {
        throw new Error("Table 'tblNOA' not found in the workbook.");
    }

    // Typed records instead of (r: string)
    const data: Record<string, string | number | null>[] = JSON.parse(records);

    const rows = data.map(r => [

        r["[Branch]"] ?? "",
        r["[Patient Name]"] ?? "",
        r["[MR No.]"] ?? "",
        r["[Payor Source]"] ?? "",
        r["[SOC Date]"] ?? "",
        r["[Visit Completed]"] ?? "",
        r["[Visit Status]"] ?? "",
        r["[Due Date]"] ?? "",
        toNumber(r["[Days]"]),
        r["[Due]"] ?? ""             // keep as text; schema defines it as a string like "PENALTY UP TO 7%"

    ]);

    const existingRows = table.getRowCount();

    if (existingRows > 0) {
        table.deleteRowsAt(0, existingRows);
    }

    if (rows.length > 0) {
        table.addRows(-1, rows);

        // Re-apply conditional formatting after the data is written
        applyDueFormatting(table, dueColumnName, formatScope);
    }

}

/**
 * Converts a value to a number. Returns "" for null, empty or non-numeric values,
 * so blanks stay blank instead of becoming 0.
 */
function toNumber(v: string | number | null | undefined): number | string {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    return isNaN(n) ? "" : n;
}

const RED = "#C00000";
const ORANGE = "#ED7D31";

/**
 * Due < 0 → bold red; Due = 0 → bold orange; otherwise unchanged.
 * Clears previous rules on the target range first, so it is safe to rerun.
 */
function applyDueFormatting(
    table: ExcelScript.Table,
    dueColumnName: string,
    scope: "cell" | "row"
): void {
    let column: ExcelScript.TableColumn | undefined;
    const columns = table.getColumns();
    for (let i = 0; i < columns.length; i++) {
        const c = columns[i];
        if (c.getName().trim().toLowerCase() === dueColumnName.trim().toLowerCase()) {
            column = c;
            break;
        }
    }
    if (!column) {
        throw new Error(`Column '${dueColumnName}' not found in table '${table.getName()}'.`);
    }

    const dueRange = column.getRangeBetweenHeaderAndTotal();
    const target = scope === "row" ? table.getRangeBetweenHeaderAndTotal() : dueRange;

    target.clearAllConditionalFormats();

    if (scope === "cell") {
        addCellValueRule(target, ExcelScript.ConditionalCellValueOperator.lessThan, RED);
        addCellValueRule(target, ExcelScript.ConditionalCellValueOperator.equalTo, ORANGE);
    } else {
        // Absolute column, relative row, e.g. "$J2"
        const firstCell = dueRange.getCell(0, 0).getAddress().split("!").pop()!;
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