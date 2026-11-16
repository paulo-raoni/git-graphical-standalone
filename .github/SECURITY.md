# Security policy

## Supported versions

Only the latest released version gets fixes. Trunks Graph is in early preview.

## What is in scope

Trunks Graph reads local Git repositories by running the `git` command line. A security problem is, for example:

- a repository whose content (branch names, messages, file names) makes the app run a command, write a file or
  change the repository;
- content from a repository running as code inside the app's window;
- the app reaching the network when it should not.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Report it privately through this repository's
**Security** tab, with **Report a vulnerability**. If that option is not available, open an issue that asks for a
private contact and gives no details.

Include the version or commit, your operating system, the steps to reproduce, and what an attacker could achieve.
You will get a reply as soon as the maintainer can give one, and credit in the fix if you want it.
