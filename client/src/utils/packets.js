/**
 * Packets and bags. One bag holds one piece; the style says how many bags
 * make a packet and how many packets a carton (10 and 10 unless it says
 * otherwise). The server's figures are in server/src/domain/shipping.js.
 */

import { fmtNum } from './format.js';

const num = (v) => Number(v || 0);

/** Pieces as packets and bags: 95 at 10 a packet is "9 pkts × 10 + 5 bags". */
export function packetsLabel(pcs, bagsPerPacket) {
  const per = num(bagsPerPacket);
  if (per <= 0 || !num(pcs)) return '';
  const packets = Math.floor(num(pcs) / per);
  const loose = num(pcs) - packets * per;
  return `${packets} pkt${packets === 1 ? '' : 's'} × ${per}${loose ? ` + ${loose} bag${loose === 1 ? '' : 's'}` : ''}`;
}

/**
 * How many boxes a Box No covers: "7" is 1, "1-20" and "C-1-20" are 20. Null
 * when it is not written as box numbers. As parseBoxNo() on the server.
 */
export function boxCount(text) {
  const m = /^(.*?)(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  return from < 1 || to < from ? null : to - from + 1;
}

/** "10 packets × 10 bags = 100 pcs" - how the style is packed. */
export function cartonMakeUp(p) {
  if (!p?.bagsPerPacket || !p?.packetsPerCarton) return '-';
  return `${p.packetsPerCarton} packets × ${p.bagsPerPacket} bags = ${fmtNum(p.pcsPerFullCarton, { decimals: 0 })} pcs`;
}

/** A total: "120 pkts + 15 bags". */
export function packetsTotal(packets, looseBags) {
  return `${fmtNum(packets, { decimals: 0 })} pkts${num(looseBags) ? ` + ${fmtNum(looseBags, { decimals: 0 })} bags` : ''}`;
}
