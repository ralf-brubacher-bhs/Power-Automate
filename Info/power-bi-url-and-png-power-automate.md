# Power BI → PNG → email with Power Automate

Practical guide to (1) breaking down a Power BI report URL and choosing the right page, (2) exporting it to PNG with Power Automate, and (3) embedding the image in an email that displays correctly in Outlook.

Official Microsoft Learn sources consulted on 2026-10-09 (listed at the end). Information **not** found in official documentation is marked **[inferred]** or **[verify]**.

---

## 1. Anatomy of a report URL

Example (from the official documentation):

```
https://app.powerbi.com/groups/338cd931-b957-4ba6-a5fa-b0113dab53aa/reports/85ac7583-3bb2-4c2c-a1fa-5a4a875ba88c/ReportSection?ctid=72f988bf-86f1-41af-91ab-2d7cd011db47
```

| Segment | Example value | What it is | Where it is used in Power Automate |
|---|---|---|---|
| `groups/{id}` | `338cd931-…53aa` | **Workspace ID** (`groupId`). `groups/me` means "My workspace." | **Workspace** field |
| `reports/{id}` | `85ac7583-…a88c` | **Report ID** (`reportId`) | **Report** field |
| Segment after the reportId | `ReportSection` | Internal **page name** (`pageName`). This is not the visible tab name. | **pageName** field (Pages - 1) |
| `?ctid=` | `72f988bf-…` | Tenant ID (Microsoft Entra). | Not used for the export |
| `?bookmarkGuid=` | `Bookmark…` | Internal name of a **report bookmark** | **Bookmark Name** field |
| `?filter=` | `Table/Field eq 'X'` | URL filter | **Filter** field (without `?filter=`) |

**Page rule:** `pageName` is the segment between the last `/` (after the reportId) and `?`. Microsoft notes that the first page is often named `ReportSection`, and subsequent pages `ReportSection1`, `ReportSection2`, or a custom name.

**[Inferred]** Reports created or saved in recent versions often have hexadecimal identifiers (e.g., `/reports/<id>/a1b2c3d4e5f6a7b8c9d0`) instead of `ReportSection…`. Use them the same way: copy the literal segment.

**Most reliable method (recommended):** instead of reading the URL manually, list the pages with the REST API *Get Pages In Group* (`GET https://api.powerbi.com/v1.0/myorg/groups/{groupId}/reports/{reportId}/pages`). It returns `name` (required for the export) and `displayName` (what the user sees). The export documentation states that valid page names are exactly those returned by this API.

**Caution with Power BI Apps [verify]:** if the URL is in the form `/groups/me/apps/{appId}/reports/{id}/…`, the ID shown belongs to the copy published in the App. For export, use the report ID **in the source workspace**.

### Individual visual (optional)
To export a single visual: open the report in **Edit** mode → select the visual → **Format visual** → **General** → **Properties** → copy **Name**. Use that value for `visualName` together with its `pageName`.

---

## 2. Prerequisites (blockers)

1. **Capacity:** the report and all its semantic models (including DirectQuery models) must be in a workspace on **Premium, Embedded, or Fabric** capacity. It does **not** work with Premium Per User (PPU) or a Pro-only workspace.
2. **Tenant settings (admin portal):**
   - *Export reports as PowerPoint presentations or PDF documents*: enabled by default.
   - ***Export reports as image files***: **required for PNG and disabled by default.**
3. **Connector:** Power BI is a **Standard** Power Automate connector, included with Microsoft 365 licenses. The connection uses the user's OAuth identity and **cannot be shared**.
4. **Permissions:** the connection user needs access to the report. To export with **RLS** (identities), the user also needs *Write* permission on the semantic model and the *Contributor* or *Admin* role in the workspace.

---

## 3. The Power Automate flow

```
Recurrence (scheduled)
  └─ Power BI · Export To File for Power BI Reports
       Workspace      = <groupId>
       Report         = <reportId>
       Export Format  = PNG
       Pages pageName - 1   = ReportSection2          ← selected page
       (optional) visualName, Bookmark Name, Filter, Locale, Identities (RLS)
  └─ Office 365 Outlook · Send an email (V2)  (or the alternative in section 4)
```

### "Export To File for Power BI Reports" action parameters

| Parameter | Use | Notes |
|---|---|---|
| Export Format | `PNG` | PDF and PPTX are also supported |
| Pages · pageName | Page to export | If you specify **one** page, you get **one .png**. If you export multiple pages (or the entire report), you receive a **.zip** with one PNG per page. |
| Pages · visualName | A single visual on that page | Optional |
| Bookmark Name / State | Page state | **Report bookmarks only.** Personal bookmarks and persistent filters are not supported. Use Name **or** State, not both. |
| Filter | URL filter without `?filter=` | Example: `Center/Region eq 'North'`. **Only 1 report-level filter is supported**, though it can combine conditions with `and`. |
| Locale | Regional format | Example: `en-US` |
| Include Hidden Pages | Hidden pages | Ignored if you specify particular pages |
| Identities (Username, Datasets, Roles) | RLS | Useful for sending each location or service only its own data |

### Filter examples (official URL syntax)

```
Patients/Service eq 'Cardiology'
Patients/Service in ('Cardiology', 'Pediatrics')
Visits/Date ge 2026-09-01 and Visits/Date lt 2026-10-01
Active_x0020_Locations/Name eq 'Central Location'  ← a space in a table name is written as _x0020_
Doctors/LastName eq 'O''Brien'                      ← escape a single quote by doubling it
```

Important rules: **table and field names are case-sensitive** (values are not); text must be in single quotes and numbers must not be quoted; tables or columns whose names start with uppercase `INF` cannot be filtered; the limit is 10 expressions joined with `and`. If the page already has saved filters, they are combined with AND and may leave the visual blank.

**Without a bookmark or filter, the export uses the saved default values** (including slicers). If you change a slicer on screen and do not save the report, the PNG will not reflect the change.

---

## 4. Embedding the PNG in an email (Outlook)

There are three options, from least to most robust:

### A. Data URI in "Send an email (V2)" (simplest)
Body in code view (`</>`):

```html
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="font-family:Arial,sans-serif;font-size:14px;">Daily metrics</td></tr>
  <tr><td>
    <img src="data:image/png;base64,@{body('Export_To_File_for_Power_BI_Reports')?['$content']}"
         width="600" alt="Metrics dashboard - Cardiology service" style="display:block;border:0;">
  </td></tr>
</table>
```

**[Verify]** Binary content is usually exposed as `{"$content-type": "...", "$content": "<base64>"}`. If `?['$content']` is empty, use `base64(body('Export_To_File_for_Power_BI_Reports'))`. Test it in a run and inspect the action output.

Limitations of this option:
- Power Automate documentation says **inline images are limited to 100 KB**, which can reduce image quality. A full-page Power BI PNG often exceeds that size **[inferred]**. Export a **visual** instead of the whole page, or use option C.
- **[Inferred, not documented by Microsoft]** Many clients, including Gmail and some versions of classic Outlook for Windows, block or do not display `data:` images. Microsoft also documents an issue in classic Outlook: Base64 images become corrupted when **forwarding** from a shared mailbox with cached mode disabled. Microsoft's official alternative is to send the image as an attachment.
- Base64 increases the size by 30% to 40%.

### B. Simple attachment (shown in the official tutorial)
In *Send an email (V2)*: **Attachments Name** = `metrics.png` and **Attachments Content** = **File Content** from the export action. This is the most reliable option, but the image does not appear in the body.

### C. Inline image using CID (recommended for Outlook)
*Send an email (V2)* does not allow an attachment to be marked as inline. To do this, send the email with **Microsoft Graph** (`POST /users/{id}/sendMail`), for example with the *Send an HTTP request* action from the Office 365 Outlook connector or an HTTP connector:

```json
{
  "message": {
    "subject": "Daily metrics",
    "body": { "contentType": "HTML",
      "content": "<img src=\"cid:dashboard1\" width=\"600\" alt=\"Dashboard\">" },
    "toRecipients": [{ "emailAddress": { "address": "address@example.org" } }],
    "attachments": [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      "name": "dashboard1.png",
      "contentType": "image/png",
      "contentId": "dashboard1",
      "isInline": true,
      "contentBytes": "@{body('Export_To_File_for_Power_BI_Reports')?['$content']}"
    }]
  }
}
```

Graph defines `isInline` and `contentId`, and the image is referenced with `<img src="cid:…">`. This is the standard mechanism and renders best in Outlook, including classic Outlook, new Outlook, and Outlook on the web.

**HTML best practices for classic Outlook for Windows**, which uses the Word rendering engine: use `<table>` for layout, inline styles, a fixed width (600–700 px), `width` as an `<img>` **attribute**, descriptive `alt` text, and no external CSS, flexbox, or grid.

---

## 5. Limits and considerations

| Topic | Limit / behavior | Source |
|---|---|---|
| Exported file size | Max. **250 MB** | Export to file |
| Pages/visuals per export | Max. **50**; the job is canceled if there are more | Export to file |
| Concurrency | 500 requests per capacity (429 error if exceeded); 5 pages in parallel per job | Export to file |
| Power BI connector throttling | **100 calls / 60 sec per connection** | Power BI connector |
| Outlook throttling | 300 calls / 60 sec | Troubleshoot email |
| Capacity load | Counts as a **slow background** operation and consumes CUs | Export to file |
| Sensitivity labels | **Not applied to PNG** (they are applied to PDF and PPTX) | Export to file |
| Unsupported visuals | R, Python, Power Apps, Power Automate, Visio, ArcGIS, paginated report visual, and **uncertified** custom visuals: an error symbol appears instead | Export to file |
| SSO | Composite models with an SSO source are not supported | Export to file |
| Exchange Online message | 35 MB default sending limit (configurable) | Exchange Online limits |
| Sovereign clouds | The connector does not work in China, Germany, or US Gov | Power BI connector |

### Areas not clearly documented
- **Timeout [verify]:** the API is asynchronous. The connector polls internally, but Microsoft does not publish how long the action waits before failing. For large reports, configure the action's **retry policy** and measure actual run times.
- **PNG resolution [not documented]:** there is no DPI or size parameter. The image uses the page canvas size (16:9, 1280×720 by default). To control the output, adjust the page size in Power BI Desktop (e.g., set a custom width of 600 px for email).
- **Up-to-date data [inferred]:** the export uses the model data available at that time. If the email must be sent after a refresh, chain *Refresh a dataset* or schedule the email after the scheduled refresh.

### Healthcare: sensitive data
The PNG **loses its sensitivity label**, and an email can be forwarded. For clinical or patient information, use RLS (Identities) so each recipient receives only their own data, prefer aggregated metrics in the image, and consider sending a **link** to the report (which respects permissions and RLS) instead of the image.

---

## 6. Quick checklist
1. [ ] Workspace on Premium/Fabric/Embedded capacity (not PPU)
2. [ ] Tenant setting "Export reports as image files" enabled
3. [ ] `groupId`, `reportId`, and `pageName` obtained (ideally with *Get Pages In Group*)
4. [ ] Export **one** page or visual (otherwise you will receive a .zip)
5. [ ] Filter, bookmark, or RLS configured (otherwise saved defaults are used)
6. [ ] Inline image using CID (Graph) or attachment; use a data URI only if under 100 KB and tested in the actual clients
7. [ ] Retry policy configured; tested in classic Outlook, new Outlook, and mobile

---

## Sources (Microsoft Learn)
- Export and email a Power BI report with Power Automate: https://learn.microsoft.com/power-bi/collaborate-share/service-automate-power-bi-report-export
- Export Power BI report to file (requirements, limits, filters, bookmarks): https://learn.microsoft.com/power-bi/developer/embedded/export-to
- Reports - Export To File In Group (REST): https://learn.microsoft.com/rest/api/power-bi/reports/export-to-file-in-group
- Reports - Get Pages In Group (REST): https://learn.microsoft.com/rest/api/power-bi/reports/get-pages-in-group
- Power BI connector (parameters, throttling): https://learn.microsoft.com/connectors/powerbi/
- Filter a report using URL parameters: https://learn.microsoft.com/power-bi/collaborate-share/service-url-filters
- Customize email in flows (100 KB limit for inline images): https://learn.microsoft.com/power-automate/email-customization
- Office 365 Outlook – Known issues and limitations: https://learn.microsoft.com/connectors/office365/#known-issues-and-limitations
- Troubleshoot email in flows: https://learn.microsoft.com/power-automate/email-troubleshooting
- Graph fileAttachment (isInline, contentId): https://learn.microsoft.com/graph/api/resources/fileattachment
- Office Add-ins known issues (Base64 in classic Outlook): https://learn.microsoft.com/office/dev/add-ins/resources/resources-office-add-in-known-issues
- Exchange Online limits: https://learn.microsoft.com/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits
