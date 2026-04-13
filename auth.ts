import { resolveStoreForNumber } from './runtime-config.ts'

function jidToNumber(jid: string): string {
    return jid.split('@')[0]
}

/**
 * Returns true if the sender is whitelisted in any store's bot config.
 * Works in both single-bot (multi-store) and multi-bot (BOT_STORE_ID) modes.
 */
export function isAllowed(jid: string): boolean {
    return resolveStoreForNumber(jidToNumber(jid)) !== null
}
