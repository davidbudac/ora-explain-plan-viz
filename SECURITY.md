# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub: [Report a vulnerability](https://github.com/davidbudac/ora-explain-plan-viz/security/advisories/new).

Include what you found, how to reproduce it (a plan text or share link that triggers it is ideal), and what an attacker could do with it. You'll get an acknowledgement within a week. Once a fix is released, the advisory is published with credit to you unless you'd rather stay anonymous.

## Supported versions

Only the latest release and the hosted app at <https://davidbudac.github.io/ora-explain-plan-viz/> receive fixes.

## Scope

The app runs entirely in the browser. Things that are in scope:

- Script injection (XSS) through plan text, share links, annotation imports, metadata bundles or AI output rendered in the app or in an exported client report.
- Plan data, annotations or API keys leaving the browser other than to the AI provider the user explicitly chose and clicked Run for.
- API keys being written anywhere other than `sessionStorage` (for example into `localStorage`, share URLs or exports).
- The optional DB connector integration (`VITE_ENABLE_DB_AGENT=1` builds): credentials or plan text going anywhere other than the local connector, or scripts running against a database without the user's explicit approval.

Vulnerabilities in the connector itself belong in [oraplanviz-db-connector](https://github.com/davidbudac/oraplanviz-db-connector/security/advisories/new).
