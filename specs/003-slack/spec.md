# 003 Slack — Feature Specification

> **Status:** Stub · **Date:** 2026-03-05
> **Phase:** 3 · **Dependencies:** Phase 2 (Build Server)
> **Replaces:** 003-telegram (removed from MVP)
> **Anchored to:** [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md), [strategic-vision.md v2](file:///Users/gonzo/.gemini/antigravity/brain/e4be238d-e6ad-44ad-bb8f-167be1a97a77/strategic-vision.md)

---

## Summary

Slack integration for the gwrk comms layer. Socket Mode (`@slack/bolt`) — outbound WebSocket, no public URL, no phone-home. Channel-per-project model. Interactive messages, slash commands, threaded DUT conversations, App Home Tab dashboard, reactions, presence-aware notifications.

## Key Decisions

- **Socket Mode** — no public URL required, runs behind firewall
- **Channel-per-project** — `gwrk new` / `gwrk init` creates `#<project-name>` channel
- **Fully automated provisioning** — `gwrk setup slack` handles everything
- **Replaces Telegram** — Telegram demoted to future P2 for non-Slack users
- **App Home Tab** — replaces Glass Dashboard SPA (FR-13)

## Gate

> Send a status update to a project channel and approve a review verdict from Slack.

## Full Spec

This stub will be expanded via `/specify` when Phase 3 development begins. The strategic vision and PRD §7 contain the full requirements.
