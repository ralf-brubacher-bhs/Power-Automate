# Flow documentation: "[Flow name]"

> Template for documenting an existing Power Automate flow that sends Power BI reports by email.
> Technical criteria (patterns, limits, licensing, governance) are **not repeated here**. Each section points to
> [power-automate-power-bi-reports.md](power-automate-power-bi-reports.md) ("General guide")
> or to [power-bi-url-and-png-power-automate.md](power-bi-url-and-png-power-automate.md) ("PNG/URL guide").
> Each section says what to fill in and where to find the criteria for assessing it.

| Field | Value |
|---|---|
| Document version | 1.0 |
| Date | YYYY-MM-DD |
| Author | |
| Business owner (area) | |
| Technical owner | |
| Flow status | Production / Test / Turned off |
| Power Platform environment | |
| Solution | (or "outside a solution") |

---

## 1. Purpose

- **What it does** (one or two sentences):
- **Who receives the report** (roles, not names; distribution lists):
- **Business decision it supports**:
- **Pattern used** (A native subscription / B Export To File / C DAX query / D paginated). Criteria: General guide §1.
- **Would a native subscription be enough?** Yes/No and why. Criteria: General guide §8.

## 2. Trigger

| Field | Value |
|---|---|
| Type | Recurrence / Power BI alert / manual / other |
| Frequency and time | |
| Time zone | |
| Dependency on the model refresh | Scheduled refresh time and margin |
| Trigger conditions | |

Criteria: General guide §2.3 and §4.

## 3. Flow diagram

```
[Trigger] → [Initialize variables] → [Try scope: query/export → build HTML → send]
                                    → [Catch scope: error notification]
```

(Replace with the actual diagram.)

## 4. Steps

One row per action, in the order shown in the designer. Use the action's display name.

| # | Action (name in the flow) | Connector / type | What it does | Key inputs | Output used later | Relevant settings (retries, timeout, Secure inputs/outputs, run after) |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

### 4.1 DAX queries

For each "Run a query against a dataset" action: semantic model, workspace, query text,
returned columns and expected row volume. Criteria and limits: General guide §2.4 and §5.2.

```dax
-- Query 1
```

### 4.2 Relevant expressions

Date, formatting and concatenation expressions that are not obvious. Criteria: General guide §4.2.

| Action | Expression | Purpose |
|---|---|---|

### 4.3 Email

| Field | Value |
|---|---|
| Action | Send an email (V2) / Send an email from a shared mailbox (V2) / other |
| Sender | |
| To / CC / BCC | |
| Subject | |
| Body format | HTML / embedded image / attachment |
| Attachments | |
| Importance | |

HTML compatibility with Outlook (tables, inline styles, images): PNG/URL guide.

## 5. Connections and connection references

| Connector | Account used | Connection reference (solution)? | DLP classification | Notes |
|---|---|---|---|---|

Criteria: General guide §2.1, §7.2, §7.3 and §7.4.

## 6. Variables and parameters

| Name | Type | Initial value / source | Use | Environment variable? |
|---|---|---|---|---|

Criteria: General guide §7.2 (workspace and model IDs and recipients should be environment variables).

## 7. Error handling

- **Try/Catch/Finally structure**: does it exist? Describe the scopes and their *run after* settings.
- **Failure notification**: who gets it and through which channel.
- **Retries**: the policy configured on each action.
- **Cases covered**: model not refreshed, empty query, truncated query (returns 200), send failure.
- **Gaps found**:

Criteria: General guide §6.

## 8. Dependencies

| Dependency | Type | Owner | Impact if it fails |
|---|---|---|---|
| Semantic model "…" | Power BI | | |
| Scheduled refresh | Power BI | | |
| Sender mailbox | Exchange Online | | |
| Licenses (Power Automate, Power BI Pro/PPU/Premium) | Licensing | | |

Licensing criteria: General guide §5.1.

## 9. Security and health data

- **Classification of the data sent**: aggregated / identifiable (PHI). List the fields.
- **Minimization**: does the email contain only what is needed?
- **Secure inputs/outputs** on the actions that handle data: Yes/No per action.
- **External recipients**: Yes/No; controls applied (encryption, sensitivity labels).
- **Row-level security (RLS)**: does the flow's account bypass it or respect it?
- **Run history retention** (30 days) and who can see it.
- **Applicable regulation** (by country):

Criteria: General guide §7.5 and §7.6.

## 10. Operations and maintenance

| Topic | Details |
|---|---|
| Monitoring | Where runs are reviewed; alerts configured |
| Co-owners | |
| Failure procedure | Steps to diagnose and resend |
| Frequent changes | Recipients, queries, schedules: how to change them |
| Credential renewal | Account and connection expiry |
| Testing before changes | Test environment, test data |

Criteria: General guide §7.7 and §9.

## 11. Findings and recommendations

Comparison of the flow against the checklist in General guide §9.

| # | Finding | Risk (High/Medium/Low) | Recommendation | Reference |
|---|---|---|---|---|

## 12. Change history

| Date | Version | Change | Author |
|---|---|---|---|
