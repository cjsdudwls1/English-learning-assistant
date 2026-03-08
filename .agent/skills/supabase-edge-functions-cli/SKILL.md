---
name: supabase-edge-functions-cli
description: Use this skill when the user asks to create, deploy, serve (run locally), or manage Supabase Edge Functions using the Supabase CLI.
---

# Supabase Edge Functions CLI Skill

This skill provides standard commands and procedures for managing Supabase Edge Functions within the current project.

## Goals
To safely and correctly execute Supabase CLI commands for Edge Functions (create, serve, deploy, secrets management).

## Instructions

When the user asks to interact with Supabase Edge Functions, follow these steps and use the `run_command` tool to execute the appropriate CLI command.

### 1. Creating a New Function
Command to create a new TypeScript Edge Function:
```bash
npx -y supabase@latest functions new <function_name>
```
*Note: This creates a new directory under `supabase/functions/<function_name>`.*

### 2. Serving Functions Locally (Testing)
Command to run functions locally for testing:
```bash
npx -y supabase@latest functions serve <function_name> --env-file .env
```
*Note: To serve all functions, omit `<function_name>`. The `--env-file` flag is necessary to load local environment variables.*

### 3. Deploying Functions
Command to deploy a function to the remote Supabase project:
```bash
npx -y supabase@latest functions deploy <function_name> --no-verify-jwt --project-ref <project-id>
```
*Note: Always verify if `--no-verify-jwt` is needed based on the user's setup. The `--project-ref` ensures it deploys to the correct environment without interactive prompts.*

### 4. Managing Secrets
Command to set environment variables (secrets) in the remote project:
```bash
npx -y supabase@latest secrets set MY_SECRET_NAME="my_secret_value" --project-ref <project-id>
```
To view all secrets:
```bash
npx -y supabase@latest secrets list --project-ref <project-id>
```

## Constraints
- **NEVER** expose raw secrets or API keys in the chat output.
- **NEVER** run commands interactively if it can be avoided (use `--project-ref` for zero-prompt deployments).
- Always use `npx -y supabase@latest` to ensure the CLI runs locally without requiring a global installation, unless the user explicitly asks to use a global `supabase` command.

## Example Usage

**User:** "Deploy the generate-report function to project xyz123."
**Agent Action:** Use the `run_command` tool to execute:
`npx -y supabase@latest functions deploy generate-report --no-verify-jwt --project-ref xyz123`
