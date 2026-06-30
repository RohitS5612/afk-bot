'use strict'

const mineflayer = require('mineflayer')

const CONFIG = {
  host: process.env.MC_HOST || 'mc.arch.lol',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'RohitS5612',
  password: process.env.MC_PASSWORD || 'Xzsawq@123',
  queueName: process.env.MC_QUEUE || 'survival',
  reconnectDelayMs: Number(process.env.RECONNECT_DELAY_MS || 10000),
  loginDelayMs: Number(process.env.LOGIN_DELAY_MS || 3000),
  loginRetryMs: Number(process.env.LOGIN_RETRY_MS || 500),
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  transferSettleMs: Number(process.env.TRANSFER_SETTLE_MS || 5000),
  queueRetryMs: Number(process.env.QUEUE_RETRY_MS || 5000),
  moveDurationMs: Number(process.env.MOVE_DURATION_MS || 900),
  transferTimeoutMs: Number(process.env.TRANSFER_TIMEOUT_MS || 120000)
}

const PHASE = {
  WAITING_FOR_FIRST_SPAWN: 'waiting_for_first_spawn',
  LOGIN_SENT: 'login_sent',
  QUEUE_SENT: 'queue_sent',
  AFK_SENT: 'afk_sent',
  POST_AFK_QUEUEING: 'post_afk_queueing'
}

let bot = null
let phase = PHASE.WAITING_FOR_FIRST_SPAWN
let actionToken = 0
let reconnectTimer = null
let queueRetryTimer = null
let fallbackTimer = null
let lastQueueAt = 0
let loginAttempts = 0
let loginRetryTimer = null

function log (message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function clearTimer (timer) {
  if (timer) clearTimeout(timer)
  return null
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function redact (message) {
  return message.replace(CONFIG.password, '********')
}

function safeChat (message) {
  if (!bot) return false
  log(`Chat: ${redact(message)}`)
  bot.chat(message)
  return true
}

function formatReason (reason) {
  if (typeof reason === 'string') return reason

  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function setPhase (nextPhase) {
  if (phase === nextPhase) return
  phase = nextPhase
  log(`Phase: ${phase}`)
}

async function moveForwardTwoBlocksAndJump (token) {
  if (!bot?.entity || token !== actionToken) return

  log('Moving forward and jumping.')
  bot.setControlState('forward', true)
  await sleep(CONFIG.moveDurationMs)
  bot.setControlState('forward', false)

  if (!bot?.entity || token !== actionToken) return
  bot.setControlState('jump', true)
  await sleep(450)
  bot.setControlState('jump', false)
}

function scheduleFallback (handler, description) {
  fallbackTimer = clearTimer(fallbackTimer)
  fallbackTimer = setTimeout(() => {
    log(`${description} transfer was not detected before timeout; continuing anyway.`)
    handler()
  }, CONFIG.transferTimeoutMs)
}

function issueQueue () {
  if (!bot?.player) return false
  lastQueueAt = Date.now()
  return safeChat(`/queue ${CONFIG.queueName}`)
}

function issueAfk () {
  if (!bot?.player) return false
  setPhase(PHASE.AFK_SENT)
  return safeChat('/afk')
}

function scheduleQueueRetry () {
  queueRetryTimer = clearTimer(queueRetryTimer)
  queueRetryTimer = setTimeout(() => {
    if (!bot?.player || phase !== PHASE.POST_AFK_QUEUEING) return
    issueQueue()
    scheduleQueueRetry()
  }, CONFIG.queueRetryMs)
}

function scheduleLoginRetry () {
  loginRetryTimer = clearTimer(loginRetryTimer)
  loginRetryTimer = setTimeout(() => {
    if (!bot || phase !== PHASE.LOGIN_SENT || loginAttempts >= CONFIG.maxLoginAttempts) return
    sendLogin('the login retry timer fired')
  }, CONFIG.loginRetryMs)
}

function sendLogin (reason) {
  if (!bot || ![PHASE.WAITING_FOR_FIRST_SPAWN, PHASE.LOGIN_SENT].includes(phase)) return false
  if (loginAttempts >= CONFIG.maxLoginAttempts) return false

  loginAttempts += 1
  setPhase(PHASE.LOGIN_SENT)
  log(`Sending login attempt ${loginAttempts}/${CONFIG.maxLoginAttempts} because ${reason}.`)
  safeChat(`/login ${CONFIG.password}`)
  scheduleFallback(afterLoginTransfer, 'Login')
  scheduleLoginRetry()
  return true
}

async function startLoginWorkflow () {
  const token = ++actionToken
  await sleep(CONFIG.loginDelayMs)
  if (!bot || token !== actionToken) return

  sendLogin('the initial login delay elapsed')
}

async function afterLoginTransfer () {
  const token = ++actionToken
  fallbackTimer = clearTimer(fallbackTimer)
  loginRetryTimer = clearTimer(loginRetryTimer)
  await sleep(CONFIG.transferSettleMs)
  if (!bot?.player || token !== actionToken) return

  await moveForwardTwoBlocksAndJump(token)
  if (!bot?.player || token !== actionToken) return

  setPhase(PHASE.QUEUE_SENT)
  issueQueue()
  scheduleFallback(afterQueueTransfer, 'Queue')
}

async function afterQueueTransfer () {
  const token = ++actionToken
  fallbackTimer = clearTimer(fallbackTimer)
  queueRetryTimer = clearTimer(queueRetryTimer)
  await sleep(CONFIG.transferSettleMs)
  if (!bot?.player || token !== actionToken) return

  await moveForwardTwoBlocksAndJump(token)
  if (!bot?.player || token !== actionToken) return

  issueAfk()
}

function startPostAfkQueueing () {
  actionToken += 1
  fallbackTimer = clearTimer(fallbackTimer)
  setPhase(PHASE.POST_AFK_QUEUEING)
  log('Detected transfer after /afk; queueing survival every 5 seconds until the next transfer.')
  issueQueue()
  scheduleQueueRetry()
}

function handleSpawn () {
  log('Spawned.')

  if (phase === PHASE.WAITING_FOR_FIRST_SPAWN) {
    startLoginWorkflow().catch(error => log(`Login workflow error: ${error.stack || error.message}`))
    return
  }

  if (phase === PHASE.LOGIN_SENT) {
    afterLoginTransfer().catch(error => log(`Post-login workflow error: ${error.stack || error.message}`))
    return
  }

  if (phase === PHASE.QUEUE_SENT || phase === PHASE.POST_AFK_QUEUEING) {
    afterQueueTransfer().catch(error => log(`Post-queue workflow error: ${error.stack || error.message}`))
    return
  }

  if (phase === PHASE.AFK_SENT) startPostAfkQueueing()
}

function scheduleReconnect () {
  reconnectTimer = clearTimer(reconnectTimer)
  reconnectTimer = setTimeout(createBot, CONFIG.reconnectDelayMs)
  log(`Reconnecting in ${CONFIG.reconnectDelayMs / 1000}s.`)
}

function createBot () {
  actionToken += 1
  loginAttempts = 0
  loginRetryTimer = clearTimer(loginRetryTimer)
  setPhase(PHASE.WAITING_FOR_FIRST_SPAWN)
  queueRetryTimer = clearTimer(queueRetryTimer)
  fallbackTimer = clearTimer(fallbackTimer)
  loginRetryTimer = clearTimer(loginRetryTimer)
  reconnectTimer = clearTimer(reconnectTimer)

  log(`Connecting to ${CONFIG.host}:${CONFIG.port} as ${CONFIG.username}.`)
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: 'offline',
    hideErrors: false
  })

  bot.on('spawn', handleSpawn)
  bot.on('login', () => {
    log('Logged into connection.')
    sendLogin('the connection login event fired')
  })
  bot.on('kicked', reason => log(`Kicked: ${formatReason(reason)}`))
  bot.on('error', error => log(`Bot error: ${error.message}`))
  bot.on('messagestr', message => {
    log(`Server: ${message}`)
    if (/\/login\s+<password>|login using/i.test(message)) sendLogin('the server requested /login')
  })

  bot.on('end', reason => {
    log(`Disconnected: ${reason || 'unknown reason'}`)
    bot = null
    queueRetryTimer = clearTimer(queueRetryTimer)
    fallbackTimer = clearTimer(fallbackTimer)
    loginRetryTimer = clearTimer(loginRetryTimer)
    scheduleReconnect()
  })
}

process.on('SIGINT', () => {
  log('Stopping bot.')
  queueRetryTimer = clearTimer(queueRetryTimer)
  fallbackTimer = clearTimer(fallbackTimer)
  loginRetryTimer = clearTimer(loginRetryTimer)
  reconnectTimer = clearTimer(reconnectTimer)
  if (bot) bot.quit('Stopping')
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('Stopping bot.')
  queueRetryTimer = clearTimer(queueRetryTimer)
  fallbackTimer = clearTimer(fallbackTimer)
  loginRetryTimer = clearTimer(loginRetryTimer)
  reconnectTimer = clearTimer(reconnectTimer)
  if (bot) bot.quit('Stopping')
  process.exit(0)
})

createBot()
