# Lumen Analytics Help Center

Lumen is an analytics workspace for operations teams. These articles describe how to build reports, connect data, and manage your workspace. All names and data in this guide are fictional.

## Feature: Reports

Reports turn a connected data source into a chart that your team can share and schedule. Every report has a name, a data source, a chart type, and an optional delivery schedule. Reports live in the **Reports** section of the sidebar.

## Feature: Integrations

Integrations connect Lumen to the systems where your data lives. The warehouse integration reads tables from a SQL data warehouse so they can be used as data sources in reports. Manage integrations from the **Integrations** section of the sidebar.

## How to create a report

Prerequisites: At least one connected data source. You need the Editor role or higher.

1. Open **Reports** from the sidebar.
2. Click **New report** in the top right of the Reports page.
3. Enter a **Report name** that your teammates will recognize, such as "Weekly fulfillment".
4. Choose a **Data source** from the list of connected sources. Reports cannot be created without one.
5. Pick a **Chart type**. Line charts work best for trends over time; bar charts work best for comparing categories.
6. Optionally choose a **Schedule** to email the report to subscribers every day or week.
7. Click **Create report** to save it. The new report appears at the top of the reports list.

## How to connect a data warehouse

Prerequisites: The hostname, database name, and a read-only username for your warehouse. You need the Admin role.

1. Open **Integrations** from the sidebar.
2. Click **Connect warehouse** on the Warehouse card.
3. Enter the warehouse **Host**, for example warehouse.example.internal.
4. Enter the **Database** name.
5. Enter the read-only **Username** that Lumen should use.
6. Enter the **Password** for that user. Lumen stores it encrypted and never shows it again.
7. Click **Test connection** to verify the credentials.
8. Click **Save connection** once the test succeeds.

## How to invite a teammate

Prerequisites: You need the Admin role.

1. Open **Settings** from the sidebar.
2. Click **Invite teammate** in the Members section.
3. Enter your teammate's email address and choose a role, then send the invitation.

## How to change the workspace time zone

1. Open **Settings** from the sidebar.
2. Choose a new **Time zone**. Scheduled reports are sent according to this time zone.
3. Click **Save changes**.

## Troubleshooting: Choose a data source before creating the report (REPORT_SOURCE_REQUIRED)

This message appears when you click **Create report** without selecting a data source. Every report needs data to chart.

Resolution: Open the **Data source** menu in the report form and pick a connected source. If the list is empty, no warehouse is connected yet — connect one from **Integrations** first, then return to the report.

## Troubleshooting: Warehouse authentication failed (WAREHOUSE_AUTH_FAILED)

This error appears after **Test connection** when the warehouse rejects the username or password. Lumen did not save the connection.

Resolution: Confirm the **Username** matches a read-only user that exists in your warehouse, re-enter the **Password**, and run **Test connection** again. If the password was recently rotated, ask your database administrator for the new one. Lumen support cannot see or reset warehouse passwords.

## Glossary

- **Data source** — A table or saved query from a connected integration that a report reads from.
- **Chart type** — How a report visualizes its data: line, bar, or table.
- **Schedule** — An optional rule that emails a report to its subscribers daily or weekly.
- **Workspace name** — The name shown to everyone in your Lumen workspace and on emailed reports.
- **Time zone** — The workspace time zone used for dates in charts and for report schedules.
