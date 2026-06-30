# AFK Bot

Headless Minecraft bot for `mc.arch.lol` using Mineflayer in offline/cracked auth mode.

## What it does

1. Connects to `mc.arch.lol:25565` as `RohitS5612`.
2. Waits for spawn, runs `/login Xzsawq@123`, and waits for a server transfer.
3. Moves forward briefly, jumps, runs `/queue survival`, and waits for another transfer.
4. Moves forward briefly, jumps, then runs `/afk`.
5. Reconnects and repeats the full workflow after a full disconnect.
6. If a server transfer is detected after `/afk`, retries `/queue survival` every 5 seconds until transferred again, then runs `/afk` again.

## Usage

```bash
npm install
npm start
```

## Configuration

The defaults match the requested server and account, but can be overridden with environment variables:

| Variable | Default |
| --- | --- |
| `MC_HOST` | `mc.arch.lol` |
| `MC_PORT` | `25565` |
| `MC_USERNAME` | `RohitS5612` |
| `MC_PASSWORD` | `Xzsawq@123` |
| `MC_QUEUE` | `survival` |
| `RECONNECT_DELAY_MS` | `10000` |
| `LOGIN_DELAY_MS` | `3000` |
| `TRANSFER_SETTLE_MS` | `5000` |
| `QUEUE_RETRY_MS` | `5000` |
| `MOVE_DURATION_MS` | `900` |

For example:

```bash
MC_PASSWORD='your-password' npm start
```
