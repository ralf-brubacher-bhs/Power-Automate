# Power Automate for emailing Power BI reports

Reference documentation for building, operating, and governing Power Automate flows that retrieve data from Power BI and send it by email in a healthcare organization.

- **Sources:** Microsoft Learn, consulted on 2026-10-22 (listed at the end). Information **not** found in official documentation is marked **[inferred]** or **[verify]**.
- **Complements** [power-bi-url-and-png-power-automate.md](power-bi-url-and-png-power-automate.md). That guide covers report URLs, *Export To File* parameters, filter syntax, and three ways to embed an image in Outlook. This document does not repeat that material; it refers to those sections.

---

## 1. Choosing a pattern

There are four ways to bring Power BI data into an email. First decide which one fits each report.

| Pattern | What the recipient receives | When to use it | Key requirement |
|---|---|---|---|
| **A. Native Power BI subscription** (without Power Automate) | Page image and link, or an attachment | Simple, internal-recipient emails with no logic | See limits in §8 |
| **B. Export the report** (*Export To File for Power BI Reports*) | PNG, PDF, or PPTX | The recipient needs an image or PDF of the dashboard, with filters or recipient-specific RLS | Premium, Fabric, or Embedded capacity (not PPU). See the PNG guide |
| **C. Query the model** (*Run a query against a dataset*, DAX) | HTML table with values in the email body | Specific metrics, alerts, or content that displays well in any email client | Works with Pro, PPU, and Premium |
| **D. Paginated report** (*Export To File for Paginated Reports*) | PDF, XLSX, DOCX, CSV, etc. | Long operational lists or print-formatted output | Premium or Fabric capacity **[verify]**, depending on the workspace type |

**Healthcare recommendation [inferred]:** use **C** for aggregated metrics in the email body (it does not depend on how Outlook displays images and sends no file), **B** when the recipient needs to see the dashboard, and **A** only when no logic is needed. In all cases, send aggregated metrics rather than identifiable patient data (see §7.6).

---

## 2. The Power BI connector

Source: [Power BI connector](https://learn.microsoft.com/connectors/powerbi/).

### 2.1 General characteristics

- **Class: Standard** in Power Automate. It does not require a Power Automate Premium license.
- **Authentication:** OAuth only, using the signed-in user. The connection **cannot be shared**: each flow uses the identity of the person who created the connection. This connector does not support a *service principal*.
- **Throttling:** **100 calls per connection every 60 seconds**.
- **Does not work** in Power BI sovereign clouds (China, Germany, and US Government).

### 2.2 Useful actions for emailing reports

| Action | What it does | Notes |
|---|---|---|
| **Export To File for Power BI Reports** | Exports a report to PNG, PDF, or PPTX | Supports pages, visuals, bookmarks, filters, locale, and RLS identities. See PNG guide, §§2–5 |
| **Export To File for Paginated Reports** | Exports a paginated report | Formats: PPTX, PDF, ACCESSIBLEPDF, XLSX, DOCX, CSV, XML, MHTML, and images (BMP, EMF, GIF, JPEG, PNG, TIFF). Accepts report parameters |
| **Run a query against a dataset** | Runs a **DAX** query and returns rows as JSON (`firstTableRows`) | Parameters: workspace, model, query, *Nulls included*, *Impersonate user* (UPN, for RLS) |
| **Run a json query against a dataset** | Uses the same API with the complete JSON body | For users who already have the REST API body |
| **Refresh a dataset** | Requests a semantic model refresh | See §4.3: it does not wait for the refresh to finish **[inferred]** |
| **Add rows to a dataset** | Inserts rows into a *push* model | Power BI real-time streaming is announced for retirement; do not use it in new designs |

### 2.3 Triggers

| Trigger | Use |
|---|---|
| **When a data driven alert is triggered** | Starts the flow when a data alert configured on a Power BI **dashboard tile** (not a report) is triggered. Returns the tile title, threshold, value, and URL |
| **Goals/scorecards** triggers (*Preview*) | A goal's status or value changes. Minimum polling interval is 300 seconds. While in preview, do not use in production |

For scheduled emails, use the **Recurrence** trigger (§4), not a trigger from the connector.

### 2.4 DAX queries from a flow (pattern C)

The action uses the REST API *Datasets - Execute Queries*. Official limits ([reference](https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries)):

- The administrator must enable the **Dataset Execute Queries REST API** tenant setting.
- The connection user needs **Read** and **Build** permissions on the model.
- One query per call and **one table** per query.
- Maximum of **100,000 rows or 1,000,000 values** (whichever comes first) and **15 MB** per query. If the limit is exceeded, the response is **HTTP 200 with truncated data**, not an error. Validate the row count.
- **120 queries per minute per user**, regardless of the model.
- DAX only (not MDX, DMV, or INFO functions). Azure Analysis Services models are not supported.
- With **RLS**, `impersonatedUserName` lets the query run as another user and return only that user's rows. Service principals are not supported for models with RLS or SSO.

Example query for an email with daily metrics (table and measure names are illustrative):

```dax
EVALUATE
SUMMARIZECOLUMNS(
    Locations[Location],
    "Shifts",              [Total Shifts],
    "Absenteeism %",       ROUND([Absenteeism Rate] * 100, 1),
    "Average Wait (min)",  ROUND([Average Wait Minutes], 0)
)
ORDER BY Locations[Location]
```

Microsoft recommends returning only the required columns, preferring `SUMMARIZECOLUMNS`, and limiting rows with `TOPN` ([DAX query best practices](https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/best-practices)).

JSON keys are returned as `Locations[Location]` or `[Shifts]`. To build the email table, use **Select** to rename them, followed by **Create HTML table**:

```
Select
  From: @{outputs('Run_a_query_against_a_dataset')?['body/firstTableRows']}
  Map:  Location       -> @{item()?['Locations[Location]']}
        Shifts         -> @{item()?['[Shifts]']}
        Absenteeism    -> @{item()?['[Absenteeism %]']}
```

**[Inferred]** *Create HTML table* generates a `<table>` without styles. Classic Outlook for Windows (the Word rendering engine) handles CSS in `<style>` inconsistently. For a stable result, build the table with inline styles (for example, use `replace()` on the generated HTML or build rows with *Select* + `join()`), following the layout guidance in the PNG guide, §4. Outlook's HTML behavior will be covered in detail in a separate guide.

---

## 3. Exporting to a file (patterns B and D)

The PNG guide covers everything related to PNG, URLs, `pageName`, filters, bookmarks, RLS, export limits, and embedding the image. Here is a summary of the points that affect flow design:

- Export is **asynchronous**. The connector waits internally and returns the file. Microsoft does not publish how long the action waits before failing **[verify]**. Configure a retry policy (§6).
- One page produces one file. Multiple pages exported to PNG produce a **.zip** file.
- Export counts as a background operation against capacity and consumes capacity units (CUs). Schedule bulk emails outside peak usage hours **[inferred]**.
- PNG **loses the sensitivity label**. PDF and PPTX retain it.

---

## 4. Scheduling

Source: [Run a cloud flow on a schedule](https://learn.microsoft.com/power-automate/run-scheduled-tasks).

### 4.1 Recurrence trigger

- **Always** configure the **time zone** and **start time** (format `YYYY-MM-DDTHH:MM:SSZ`). If the start time is not set, the flow may run earlier than expected ([troubleshoot triggers](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot)).
- With a local time zone (for example, *(UTC-03:00) Buenos Aires*), the schedule follows local time. With UTC, it must be recalculated if the country changes its clocks **[inferred]**.
- Use **On these days** and **At these hours / minutes** to set weekdays and exact times.
- Minimum interval: **60 seconds**; maximum: **500 days**.

### 4.2 Dates in the email

Dates in Power Automate are usually in UTC. For the subject and body, use **Convert time zone** or this expression:

```
convertTimeZone(utcNow(), 'UTC', 'Argentina Standard Time', 'dd/MM/yyyy')
```

([Convert time zone](https://learn.microsoft.com/power-automate/convert-time-zone)). The time-zone name follows the Windows format; **[verify]** the correct one for your country.

### 4.3 Sending with up-to-date data

- **Recommended option [inferred]:** keep the refresh in the Power BI **model schedule** and schedule the flow with a buffer after the refresh window. Shared capacity allows up to 8 scheduled refreshes per day; Premium, PPU, or Fabric allows 48 ([Data refresh in Power BI](https://learn.microsoft.com/power-bi/connect-data/refresh-data)).
- **Refresh a dataset** only **requests** the refresh. The API is asynchronous, so the action finishes before the refresh does **[inferred]**. To wait for the result, poll `GET .../datasets/{id}/refreshes?$top=1` in a *Do until* loop, which requires an HTTP with Microsoft Entra ID connector. That connector is **Premium**; **[verify]** the license in your tenant.
- Refreshes started through the API **do not send Power BI's refresh-failure email**. If you use them, the flow must notify you of failures.
- Power BI **pauses scheduled refresh** for a model if nobody visits its reports for two months. This can happen if users only consume the exported email. A native subscription to the report avoids the pause ([refresh data](https://learn.microsoft.com/power-bi/connect-data/refresh-data); [subscriptions](https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe)).

### 4.4 Triggering on an alert

For threshold notifications (for example, bed occupancy above 90%), configure a data alert on a dashboard tile and use the *When a data driven alert is triggered* trigger. This avoids polling with *Recurrence*.

---

## 5. Licensing and limits

### 5.1 Power Automate licensing

Sources: [Request limits and allocations](https://learn.microsoft.com/power-platform/admin/api-request-limits-allocations), [Limits and configuration](https://learn.microsoft.com/power-automate/limits-and-config), [Licensing FAQ](https://learn.microsoft.com/power-platform/admin/power-automate-licensing/faqs).

- **Power BI** and **Office 365 Outlook** are **Standard** connectors: a flow that uses only these connectors works with the owner's **Microsoft 365** license.
- You need **Power Automate Premium** (per user) or **Process** (per flow) if you use Premium connectors such as HTTP, HTTP with Microsoft Entra ID, Dataverse, or Azure Key Vault.
- A flow **uses its owner's license**. If the owner leaves the organization, the flow falls back to the *Low* performance profile.

**Power Platform requests (PPRs) per 24 hours.** Each trigger and action counts as a request, including those running inside loops, retries, and pagination.

| License | Official limit | Limit during the current transition period |
|---|---|---|
| Microsoft 365 / Office 365 | 6,000 per user | 10,000 per flow |
| Power Automate Premium | 40,000 per user | 200,000 per flow |
| Power Automate Process | 250,000 per license (stackable up to 10 in a flow) | 500,000 per license |

All licenses also have a limit of **100,000 requests every 5 minutes**.

**Estimate [inferred]:** a daily email with 1 trigger, 1 query, *Select*, *Create HTML table*, *Compose*, and 1 email uses about 6 requests. A loop through 30 locations with one export and email per location uses about 100 requests per run. Both options fit comfortably within a Microsoft 365 license. At scale, the limit reached first is the **connector throttle**: 100 calls/minute in Power BI and 300 calls/minute in Outlook.

### 5.2 Platform limits

| Limit | Value | Source |
|---|---|---|
| Run duration | 30 days | limits-and-config |
| Run history retention | 30 days | limits-and-config |
| Synchronous outbound request | 120 seconds (asynchronous actions can take longer) | limits-and-config |
| Message size | 100 MB (1 GB with chunking, if supported by the action) | limits-and-config |
| Actions per flow / nesting | 500 / 8 levels | limits-and-config |
| Characters per expression | 8,192 | limits-and-config |
| Flows per user (outside solutions) | 600 | limits-and-config |
| Flow with continuous errors | Turned off after **14 days** | limits-and-config |
| Flow with no runs | May be turned off after **90 days** (does not apply with a Premium or Process license; notice is sent 30 days beforehand) | limits-and-config |
| Flow with continuous throttling | Turned off after 14 days | limits-and-config |

Power BI limits (exports and queries) and Exchange limits (35 MB per message) are covered in §2.4 and in the PNG guide, §5.

---

## 6. Robust flow design

Source: [Employ robust error handling](https://learn.microsoft.com/power-automate/guidance/coding-guidelines/error-handling).

### 6.1 Recommended structure

```
Recurrence  (time zone + start time)
├─ Initialize variables / Compose configuration   ← reads environment variables
├─ Scope "Try"
│   ├─ Power BI · Run a query against a dataset    (or Export To File)
│   ├─ Select + Create HTML table / Compose body
│   └─ Office 365 Outlook · Send an email from a shared mailbox (V2)
├─ Scope "Catch"   (Configure run after: has failed, has timed out)
│   ├─ Filter array on result('Try')  → actual error
│   ├─ Compose: run URL (workflow())
│   └─ Notify the support team (Teams or email)
└─ Scope "Finally" (optional: log to a list or table)
```

### 6.2 Rules

1. Use **Try/Catch with Scopes** and *Configure run after*. Put error notifications in *Catch*, not in every action.
2. Use an **exponential retry policy** for Power BI actions (export and query). Each retry counts as a request.
3. Include a **link to the run** in the error notification, built with `workflow()`:
   `https://make.powerautomate.com/environments/@{workflow()?['tags']?['environmentName']}/flows/@{workflow()?['tags']?['logicAppName']}/runs/@{workflow()?['run']?['name']}`
4. **Idempotency.** Power Automate provides "at least once" delivery, so an action may run twice and send duplicate emails ([troubleshoot triggers](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot)). For critical emails, record and check the key `date + report + recipient` before sending.
5. **Validate data before sending.** If the query returns 0 rows or exactly the maximum (a sign of truncation), do not send; notify someone.
6. **For many recipients**, use *Apply to each* with the **concurrency control** set to avoid exceeding connector limits **[inferred]**: 100/minute for Power BI and 300/minute for Outlook.
7. **Sender:** use *Send an email from a shared mailbox (V2)* with an institutional mailbox (e.g., `reports@…`) so replies do not go to the flow owner's personal mailbox **[inferred]**.

---

## 7. Governance and security

### 7.1 Environments

- **Do not build production flows in the default environment** (*Default*): all employees have access to it. Microsoft recommends **dedicated environments** for highly confidential data ([Manage the default environment](https://learn.microsoft.com/power-platform/guidance/adoption/manage-default-environment)).
- Minimum separation **[inferred]:** *Development* → *Production* (and *Test* if there is more than one developer).
- Enable **Managed Environments** in production: sharing limits, usage insights, and security recommendations ([Secure the default environment](https://learn.microsoft.com/power-platform/guidance/adoption/secure-default-environment)). **[Verify]** Managed Environments may require users to have Premium licenses.
- **Environment region:** choose the data region required by local regulations when creating the environment **[inferred]**.

### 7.2 Solutions and ALM

- Create flows **inside a solution**. This is required to assign Process licenses, use environment variables, and store run history in Dataverse.
- **Connection references** decouple the connection from the flow. Assign the appropriate connection in each environment without editing the flow ([Pre-populate connection references](https://learn.microsoft.com/power-platform/alm/conn-ref-env-variables-build-tools)).
- Use **environment variables** for everything that changes between environments: workspace, report, and model IDs; recipient lists; sender mailbox; and support channel ([Create environment variables](https://learn.microsoft.com/power-automate/environment-variables)). Limitation: if the value is changed directly in the environment, the flow continues to use the old value until it is saved or turned off and on again.
- Move the flow between environments as a **managed solution**, using Power Platform Pipelines or Build Tools.

### 7.3 Flow identity

- Because the Power BI connector uses the user's identity and cannot be shared (§2.1), **[inferred]** use a dedicated, non-personal **service account** with the following:
  - a license that covers Power Automate and read access to the workspace;
  - **Build** permission on the model if using DAX queries;
  - **Contributor** role in the workspace if exporting with RLS identities (PNG guide, §2);
  - MFA and conditional access according to organizational policy. **[Verify]** that these do not interrupt connection token renewal.
- Add **co-owners** (a security group) so the flow is not orphaned.

### 7.4 Data loss prevention (DLP) policies

Sources: [Data policy strategy](https://learn.microsoft.com/power-platform/guidance/adoption/dlp-strategy), [Connector classification](https://learn.microsoft.com/power-platform/admin/dlp-connector-classification).

- Place **Power BI**, **Office 365 Outlook**, **SharePoint**, **Teams**, and **Dataverse** in the **Business** group. A flow cannot combine *Business* and *Non-business* connectors.
- **Block** consumer connectors (Gmail, Dropbox, social networks, etc.) in the production environment to prevent healthcare data from leaving through them. Microsoft Standard connectors cannot be blocked, only classified.
- **Be careful with HTTP connectors:** blocking them also breaks *Run a Child Flow*, which depends on them internally.
- A flow that violates the policy is saved but **suspended**.
- **Advanced connector policies** (an allow list, with everything blocked by default) are the evolution of the model. For now, they only cover certified connectors.

### 7.5 Hiding data in run history

Run history stores **inputs and outputs for every action for 30 days**. Any flow owner or co-owner can view it. In healthcare:

- Enable **Secure inputs** and **Secure outputs** (Settings → Security) for the DAX query, export, *Select*, and email action ([Secure data used in cloud flows](https://learn.microsoft.com/power-automate/guidance/coding-guidelines/use-secure-inputs-outputs-triggers)).
- Do not put secrets in the flow. Use **Azure Key Vault**, secret-type environment variables, or the connector (Premium).
- **[Inferred, based on Logic Apps]** Some built-in actions (*Compose*, *Parse JSON*, variables) do not have *Secure outputs*. Avoid leaving sensitive data in them or secure the next action.

### 7.6 Healthcare data and compliance

- Power Automate, Power BI, and Exchange Online are covered by Microsoft's **HIPAA Business Associate Agreement**, included by default in the online services terms, and have **HITRUST CSF** certification. Microsoft clarifies that the BAA **does not** guarantee compliance on its own: configuration and use are the customer's responsibility ([HIPAA/HITECH](https://learn.microsoft.com/compliance/regulatory/offering-hipaa-hitech)).
- **Outside the U.S. [inferred]:** apply local data-protection law. In Argentina, Law 25,326 classifies health data as **sensitive data**. Confirm the applicable requirements with Legal or Compliance.
- Minimum practices for email content **[inferred]:**
  1. Send **aggregated metrics**, never patient names, identification numbers, or diagnoses.
  2. If a recipient needs details, send a **link to the report**, which respects permissions and RLS, rather than the data itself.
  3. Use RLS (`impersonatedUserName` or *Identities*) so each location or service receives only its own data.
  4. Apply Microsoft Purview **sensitivity labels** to the email. Remember that the PNG does not inherit the report's label.
  5. Review who has access to the flow, because run history stores the data (§7.5).

### 7.7 Monitoring

- Flow **analytics** and the **Automation center** show runs and errors.
- The **CoE Starter Kit** can inventory orphaned flows, connectors in use, and compliance ([CoE tenant hygiene](https://learn.microsoft.com/power-platform/guidance/coe/after-setup-tenant-hygiene)).

---

## 8. When a native Power BI subscription is enough

Source: [Email subscriptions](https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe).

A native subscription is a good fit when the email is fixed, goes to internal recipients, and needs no logic. Switch to Power Automate when you encounter one of these limits:

- **24 subscriptions** per report or dashboard (paginated reports do not have this limit).
- **External recipients** are supported only from workspaces with paid capacity (not PPU or trial).
- Maximum execution time of **60 minutes**.
- With **RLS**, the content reflects the subscription creator's permissions. This can expose data.
- **Unsupported visuals:** uncertified custom visuals, ArcGIS, Power Apps, Power Automate, paginated report visual, and Visio.
- **Dynamic per-recipient subscriptions** (paginated reports): maximum 1,000 recipients and 10 minutes.
- Duplicate emails may arrive when daylight saving time changes.

---

## 9. Production readiness checklist

1. [ ] Pattern selected for each report (§1), with data limited to aggregated metrics (§7.6)
2. [ ] Dedicated production environment, Managed Environment, and DLP policy applied (§7.1, §7.4)
3. [ ] Flow is inside a solution, with *connection references* and environment variables (§7.2)
4. [ ] Service account is the owner, a group is a co-owner, and Power BI permissions are verified (§7.3)
5. [ ] Power BI tenant settings enabled: *Dataset Execute Queries REST API* (for DAX) and *Export reports as image files* (for PNG)
6. [ ] *Recurrence* has a time zone and start time, and is scheduled after the model refresh (§4)
7. [ ] Try/Catch, exponential retries, row validation, and notification with a run link are configured (§6)
8. [ ] *Secure inputs/outputs* enabled on actions containing data (§7.5)
9. [ ] Email sent from a shared mailbox; tested in classic Outlook, new Outlook, Outlook on the web, and mobile (PNG guide, §4)
10. [ ] Request usage estimated against the license and connector throttling limits (§5)

---

## Sources (Microsoft Learn)

**Power Automate**
- Limits of automated, scheduled, and instant flows: https://learn.microsoft.com/power-automate/limits-and-config
- Request limits and allocations: https://learn.microsoft.com/power-platform/admin/api-request-limits-allocations
- Power Automate licensing FAQ: https://learn.microsoft.com/power-platform/admin/power-automate-licensing/faqs
- Understand platform limits and avoid throttling: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/understand-limits
- Run a cloud flow on a schedule: https://learn.microsoft.com/power-automate/run-scheduled-tasks
- Convert a time zone: https://learn.microsoft.com/power-automate/convert-time-zone
- Troubleshoot triggers: https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot
- Employ robust error handling: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/error-handling
- Secure data used in cloud flows: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/use-secure-inputs-outputs-triggers
- Create environment variables: https://learn.microsoft.com/power-automate/environment-variables
- Environment variables in solution cloud flows (limitations): https://learn.microsoft.com/power-apps/maker/data-platform/environmentvariables-power-automate
- Pre-populate connection references and environment variables: https://learn.microsoft.com/power-platform/alm/conn-ref-env-variables-build-tools

**Power BI**
- Power BI connector: https://learn.microsoft.com/connectors/powerbi/
- Datasets - Execute Queries (REST): https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries
- Best practices for the Execute DAX Queries REST API: https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/best-practices
- Data refresh in Power BI: https://learn.microsoft.com/power-bi/connect-data/refresh-data
- Enhanced refresh with the REST API: https://learn.microsoft.com/power-bi/connect-data/asynchronous-refresh
- Export and email a Power BI report with Power Automate: https://learn.microsoft.com/power-bi/collaborate-share/office-integration/service-automate-power-bi-report-export
- Email subscriptions: https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe
- Dynamic per recipient subscriptions: https://learn.microsoft.com/power-bi/collaborate-share/dynamic-subscriptions

**Governance and compliance**
- Implement a data policy strategy: https://learn.microsoft.com/power-platform/guidance/adoption/dlp-strategy
- Connector classification: https://learn.microsoft.com/power-platform/admin/dlp-connector-classification
- Impact of data policies on apps and flows: https://learn.microsoft.com/power-platform/admin/dlp-impact-policies-apps-flows
- Advanced connector policies: https://learn.microsoft.com/power-platform/admin/advanced-connector-policies
- Manage the default environment: https://learn.microsoft.com/power-platform/guidance/adoption/manage-default-environment
- Secure the default environment: https://learn.microsoft.com/power-platform/guidance/adoption/secure-default-environment
- Establish tenant hygiene with the CoE Starter Kit: https://learn.microsoft.com/power-platform/guidance/coe/after-setup-tenant-hygiene
- HIPAA & HITECH: https://learn.microsoft.com/compliance/regulatory/offering-hipaa-hitech
- Compliance in Microsoft for Healthcare: https://learn.microsoft.com/industry/healthcare/compliance-overview
