function main(
    workbook: ExcelScript.Workbook,
    records: string
) {

    const table = workbook.getTable("tblNOA");

    const data = JSON.parse(records);

    const rows = data.map((r: string) => [

        r["[Branch]"],
        r["[Patient Name]"],
        r["[MR No.]"],
        r["[Payor Source]"],
        r["[SOC Date]"],
        r["[Visit Completed]"],
        r["[Visit Status]"],
        r["[Due Date]"],
        Number(r["[Days]"]),
        r["[Due]"] ?? ""

    ]);

    const existingRows = table.getRowCount();

    if (existingRows > 0) {
        table.deleteRowsAt(0, existingRows);
    }

    if (rows.length > 0) {
        table.addRows(-1, rows);
    }

}
