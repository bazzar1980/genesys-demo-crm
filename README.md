# Genesys CRM Demo

A lightweight fake CRM for customer experience and Genesys Cloud demonstrations. It runs locally with sample data and can optionally connect to a Genesys Cloud organization through the Embeddable Framework and Work Automation APIs.

## Features

- Dashboard with CRM activity summaries.
- Contact and company records, searchable and editable.
- Cases linked to contacts and companies, with status and priority.
- Interaction history, including type, notes, duration, wrap-up and status.
- Genesys Composable Desktop panels in the interaction detail drawer: Copilot, Scripts (Scripter), ACW, Email and Messaging. Panels are associated with the Genesys interaction when it has a Genesys ID.
- Login with demo admin and agent roles; admin page for user management.
- Genesys Cloud softphone embedding and interaction context, when configured.
- Per-user Genesys integration modes configurable by an administrator: Embedded, Headless or Disabled.
- Work Automation view for assigned work items, with accept, park, disconnect, terminate, transfer, status and wrap-up actions.
- CRM screen-pop support through the /open URL parameters.
- SQLite database seeded with fictional demo records on first run.

Genesys Cloud integration requires a Genesys Cloud organization, an OAuth client configured for the appropriate deployment, and HTTPS for embedding. The app remains usable as a standalone fake CRM without those credentials.

## Requirements

- Node.js 22.5 or newer (uses the built-in node:sqlite module).
- npm.

## Run locally

    npm install
    npm start

Open http://localhost:8080 for standalone CRM use. On first launch, the app creates crm.db and seeds fictional records. HTTPS starts only when local certificate and key files are present or configured. Genesys framework-local-secure mode requires HTTPS on port 443.

Demo accounts:

| Role | Username | Password |
|---|---|---|
| Administrator | admin | admin |
| Agent | agent | agent |

These credentials are intentionally simple for local demonstrations. Change or disable them before exposing the app to a network. This demo is not hardened for production use.

## Optional Genesys Cloud setup

1. Create an OAuth client for the Genesys Cloud Embeddable Framework and configure its allowed origins and redirect settings for your deployment.
2. In src/framework.js, set the Client ID for your Genesys Cloud region under window.Framework.config.clientIds.
3. Serve the app over HTTPS and configure the Genesys Cloud app/iframe to point to the deployed URL.
4. Sign in to Genesys Cloud in the embedded client. The Work Automation view uses the agent session token to call Genesys Cloud APIs.

Client IDs are browser-visible identifiers, not client secrets. Never put client secrets, access tokens, production private keys or real customer data in this repository. The included localhost certificate and private key are self-signed test assets only. All Client ID entries are blank in the public demo copy.

## Administrator: integration modes

In the Admin panel (`/admin`), an administrator can enable or disable Genesys Cloud Integration for each user and choose that user's Softphone Mode:

- **Embedded** — shows the full Genesys softphone iframe in the CRM. The user also has access to the Work Automation view when integration is enabled.
- **Headless** — keeps the Genesys iframe running off-screen and shows the CRM call bar instead. The bar provides incoming-call answer/decline, in-call hang-up, and after-call-work wrap-up controls. Work Automation remains available.
- **Disabled** — does not load the softphone and hides the call bar and Work Automation view for that user.

The **Can use Genesys Cloud Integration** checkbox is the access switch: when unchecked, it disables the integration regardless of the selected Softphone Mode. When enabled, the selected mode applies to that user. New users default to Embedded mode with integration enabled.

No certificates or private keys are included in the public repository. The server starts HTTP on port 8080 (or PORT). To enable HTTPS for Genesys framework-local-secure mode, provide your own local test or deployment certificate and key using SSL_CERT_FILE and SSL_KEY_FILE; SSL_CA_FILE is optional. HTTPS listens on port 443 (or HTTPS_PORT). Keep private keys outside Git and do not use self-signed test certificates in production.

## Data and configuration

- SQLite data is stored in crm.db beside server.js; it is generated locally and ignored by Git.
- Demo rows use fictional names and .example email domains.
- PORT controls the HTTP port (default 8080); HTTPS_PORT controls optional HTTPS (default 443, required by framework-local-secure).
- SSL_KEY_FILE and SSL_CERT_FILE point to local certificate files you provide; SSL_CA_FILE is optional. These files are not tracked.

## Configuration reference

| Area | File or setting | What to configure |
|---|---|---|
| Embeddable Framework | src/framework.js | Region Client ID, Framework settings, language, and custom interaction attributes. Client IDs are browser-visible; never add a client secret. |
| Genesys client region | src/index.html | The softphone iframe URL must use the same Genesys Cloud region as the OAuth client. |
| Composable Desktop | src/scripts/composable-desktop.js | ENVIRONMENT, COMPONENT_NAME, and GADGETS. Each gadget entry sets its key, component path, scope, unique scopeId (for embedded scopes), and size. |
| User access and softphone mode | Admin page at /admin | Enable/disable Genesys integration and choose Embedded, Headless, or Disabled per user. |
| Local HTTPS | HTTPS_PORT, SSL_KEY_FILE, SSL_CERT_FILE, optional SSL_CA_FILE | HTTPS is optional and enabled only when a local certificate and key are available; port 443 is required for framework-local-secure. No certificate/private key is bundled. |
| Demo data | server.js and crm.db | server.js creates the SQLite schema and seeds fictional rows when the database is empty. crm.db is local runtime data and is ignored by Git. |

The Composable Desktop component name in this demo is the predefined Genesys component name. A custom component name may require Genesys-side whitelisting. Keep the EF iframe region and Composable Desktop ENVIRONMENT aligned with the target organization.

## Adding and removing custom test logic

There is no runtime plugin manager for arbitrary CRM rules. Keep temporary test logic isolated so it can be enabled for one scenario and removed without leaving old behavior in the core flow.

### Example workflow: match a customer, create a case, and screen-pop it

#### What the app already does

- For an assigned work item, the CRM attempts a contact match using the work item's external tag or name. The screen-pop toast lets the agent open the matched contact; if there is no match, it offers to create a contact.
- When the agent accepts a work item, the CRM logs a Workitem interaction. It tries to match a contact and associates the contact, company, and an existing Open or In Progress case when found.
- The Work Automation panel's Create Case button opens the case form with the matched contact, company, and work item ID prefilled. Saving creates the case and opens its detail drawer.
- The current flow does not automatically create a case just because a work item arrived or was accepted.

The relevant implementation is in wiUpdateCrmBar and wiCreateInteractionForWorkitem in src/scripts/services.js. Contact lookup uses /api/contacts/search; case creation uses the authenticated POST /api/cases route.

#### Test an automatic case-on-accept rule

A common demo variation is: accept work item → find contact → reuse an open case, or create one → associate it with the contact/company/work item → open the case drawer.

Use the existing contact match and open-case lookup inside wiCreateInteractionForWorkitem. If a contact is found and no open case exists, create the case with the existing API, then pass its ID to the Workitem interaction:

    async function createCaseForContact(workitem, contact) {
      return API.post('/api/cases', {
        title: workitem.name || 'Work item follow-up',
        description: 'Created from work item ' + workitem.id,
        status: 'Open',
        priority: 'Medium',
        contact_id: contact.id,
        company_id: contact.company_id || null,
        workitem_id: workitem.id
      });
    }

    // In the matched-contact branch, after checking for an open case:
    const caseToUse = openCase || await createCaseForContact(workitem, contact);
    doCreate(contact.id, contact.company_id, caseToUse ? caseToUse.id : null);
    if (caseToUse && caseToUse.id) {
      CRM.navigate('cases');
      await CRM.openDrawer('case', caseToUse.id);
    }

Treat this as a pattern to adapt inside the existing async notification flow, not as a standalone drop-in file: that flow already creates the interaction and can also receive duplicate status notifications. Keep the existing active-interaction guard so one accepted work item does not create duplicate cases or interactions. Decide explicitly what to do when no contact matches (skip automatic case creation, create an unlinked case, or ask the agent); the sample above assumes a matched contact.

To open an existing case directly, the CRM supports /open?case_id=CASE_ID. In-app, CRM.navigate('cases') plus CRM.openDrawer('case', caseId) opens the case detail as a screen-pop.

To test safely, use a unique work item/name and a local database. Confirm the match, case links, and interaction link in the CRM; then disable the rule or revert the test branch. The current manual Create Case button remains available for tests that should not create cases automatically.
### Client-side experiment

1. Create a separate file, for example src/scripts/custom-demo-logic.js.
2. Add a script tag for it in src/index.html after services.js. Do not edit the production Genesys adapter unless the experiment specifically tests that adapter.
3. Guard the behavior with a query parameter so it is off by default:

       const enabled = new URLSearchParams(location.search).get('demoLogic') === 'my-rule';
       if (enabled) {
         window.addEventListener('message', event => {
           let message = event.data;
           if (typeof message === 'string') {
             try { message = JSON.parse(message); } catch { return; }
           }
           if (message?.type === 'interactionSubscription') {
             console.log('Custom test hook', message.data);
           }
         });
       }

4. Log in first, then open https://localhost/?demoLogic=my-rule. Without that query value, this example hook does nothing.
5. To remove the experiment, remove its script tag (and the file if it is no longer needed). Revert the test branch when the change should not be retained.

This example only observes the Framework interaction message; it does not change CRM data or Genesys state. If a custom rule needs to update the CRM, call the existing authenticated API from the experiment. If it needs new persistence or server behavior, add the schema/API change in server.js and the corresponding UI behavior separately.

### Keep test changes reversible

- Start each experiment on a branch, for example git switch -c test/my-demo-rule.
- Keep test-only code in its own file or a clearly named function; avoid mixing it into unrelated screen-pop, authentication, or work-item handlers.
- Use fictional records and the local SQLite database. Back up or reset crm.db before experiments that create or delete records; the database is local and ignored by Git.
- Disable an experiment with its query/config flag first, then remove the script include or revert the branch when finished.
- Never place access tokens, client secrets, real customer records, or production certificates in test logic.
- Validate message origins and permissions before adapting a local experiment for a shared or production deployment.
## API overview

Authenticated API routes cover:

- /api/users — admin user management.
- /api/companies and /api/companies/:id — company records and search.
- /api/contacts and /api/contacts/:id — contact records and search.
- /api/cases and /api/cases/:id — cases and search.
- /api/interactions and /api/interactions/:id — interaction history.
- /auth/login, /auth/logout, /auth/me — session authentication.

The /open route accepts screen-pop parameters such as phone, email, contact_id, company_id, case_id, and view.

## Repository contents

server.js contains the Express server and SQLite schema. src/ contains the CRM interface, administration page, Genesys integration framework and Composable Desktop configuration, and browser-side services. Old dated snapshots, generated databases, and installed dependencies are excluded from the public copy. Local certificates and private keys are excluded from Git.

## License

MIT. See LICENSE.
