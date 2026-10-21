/**
 * External QC, the Alteration Unit and the finishing pipeline - the
 * arithmetic, with no database. domain/finishing.js.
 *
 *      node --test test/finishing.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  IRON,
  QC_REASONS,
  REASON_FIELDS,
  alterationProblems,
  bagBalance,
  bagStatus,
  bagsOf,
  ironOf,
  pctText,
  pipeline,
  qcProblems,
  reasonSum,
  shareOf,
} from '../src/domain/finishing.js';

const zeros = Object.fromEntries(REASON_FIELDS.map((f) => [f, 0]));
const entry = (over) => ({ pcsOffered: 100, pcsApproved: 100, pcsAlteration: 0, pcsRejected: 0, ...zeros, ...over });

describe('External QC - the three boxes and their reasons', () => {
  test('the five reasons, in order', () => {
    assert.deepEqual(QC_REASONS.map((r) => r.key), ['Alter', 'Iron', 'Defected', 'Spoiled', 'Other']);
    assert.equal(REASON_FIELDS.length, 10);
  });

  test('a sound entry has no problems', () => {
    const e = entry({ pcsApproved: 80, pcsAlteration: 15, pcsRejected: 5, altAlter: 10, altIron: 5, rejSpoiled: 5 });
    assert.deepEqual(qcProblems(e), []);
  });

  test('Approved + Alteration + Rejected must equal Pcs Offered', () => {
    const p = qcProblems(entry({ pcsApproved: 90, pcsAlteration: 5, altAlter: 5 }));
    assert.equal(p.length, 1);
    assert.match(p[0].message, /= 95, but 100 were offered/);
  });

  test('so must too many', () => {
    const p = qcProblems(entry({ pcsApproved: 100, pcsRejected: 1, rejOther: 1 }));
    assert.match(p[0].message, /101, but 100/);
  });

  test("in each box the reasons must add up to the box's total", () => {
    const p = qcProblems(entry({ pcsApproved: 80, pcsAlteration: 15, pcsRejected: 5, altAlter: 10, altIron: 4, rejSpoiled: 6 }));
    assert.equal(p.length, 2);
    assert.match(p[0].message, /Alteration box holds 15 but its reasons add up to 14/);
    assert.match(p[1].message, /Rejected box holds 5 but its reasons add up to 6/);
  });

  test('a reason in one box does not count for the other', () => {
    // 10 Alter, all filed under Rejected - the Alteration box is unexplained.
    const p = qcProblems(entry({ pcsApproved: 90, pcsAlteration: 10, rejAlter: 10 }));
    assert.equal(p.length, 2);
  });

  test('nothing offered is a problem', () => {
    assert.match(qcProblems(entry({ pcsOffered: 0, pcsApproved: 0 }))[0].message, /pieces offered/);
  });

  test('checker codes cannot carry more pieces than were faulty', () => {
    const e = entry({ pcsApproved: 90, pcsAlteration: 10, altDefected: 10, checkers: [{ pcs: 6 }, { pcs: 5 }] });
    assert.match(qcProblems(e)[0].message, /11 pieces are traced to checker codes, but only 10/);
    assert.deepEqual(qcProblems({ ...e, checkers: [{ pcs: 10 }] }), []);
  });

  test('reasonSum reads one box', () => {
    const e = entry({ altAlter: 1, altIron: 2, altDefected: 3, altSpoiled: 4, altOther: 5, rejOther: 100 });
    assert.equal(Number(reasonSum(e, 'ALTERATION')), 15);
    assert.equal(Number(reasonSum(e, 'REJECTED')), 100);
  });
});

describe('External QC - where each piece goes next', () => {
  const e = entry({
    pcsApproved: 70,
    pcsAlteration: 20,
    pcsRejected: 10,
    altAlter: 8, altIron: 6, altDefected: 4, altSpoiled: 1, altOther: 1,
    rejAlter: 1, rejIron: 3, rejDefected: 2, rejSpoiled: 3, rejOther: 1,
  });

  test('Iron in either box goes back to ironing', () => {
    assert.equal(Number(ironOf(e)), 9);
  });

  test('every other box and reason is a bag for the Alteration Unit - never Iron', () => {
    const bags = bagsOf(e);
    assert.equal(bags.length, 8, 'two boxes x four reasons, zeros included so a correction to nothing is seen');
    assert.ok(bags.every((b) => b.reason !== IRON));
    const bagged = bags.reduce((a, b) => a + Number(b.qty), 0);
    assert.equal(bagged, 20 + 10 - 9, 'faulty less Iron');
  });

  test('approved + back to ironing + to the Alteration Unit = offered', () => {
    const bagged = bagsOf(e).reduce((a, b) => a + Number(b.qty), 0);
    assert.equal(Number(e.pcsApproved) + Number(ironOf(e)) + bagged, Number(e.pcsOffered));
  });

  test('shares are of the pieces offered', () => {
    assert.equal(pctText(shareOf(70, 100)), '70.0%');
    assert.equal(pctText(shareOf(1, 3)), '33.3%');
    assert.equal(pctText(shareOf(5, 0)), '-');
  });
});

describe('the Alteration Unit', () => {
  test('balance = received - altered - not repairable', () => {
    assert.equal(Number(bagBalance({ qty: 40, pcsAltered: 30, pcsNotRepairable: 5 })), 5);
  });

  test('a bag is open, closed, or cancelled at its source', () => {
    assert.equal(bagStatus({ qty: 40, pcsAltered: 30, pcsNotRepairable: 5 }), 'OPEN');
    assert.equal(bagStatus({ qty: 40, pcsAltered: 35, pcsNotRepairable: 5 }), 'CLOSED');
    assert.equal(bagStatus({ qty: 0, pcsAltered: 0, pcsNotRepairable: 0 }), 'CANCELLED');
  });

  test('an entry says something, names its staff, and explains what cannot be repaired', () => {
    assert.match(alterationProblems({ pcsAltered: 0, pcsNotRepairable: 0, staffId: 'x' })[0].message, /altered/);
    assert.match(alterationProblems({ pcsAltered: 1, pcsNotRepairable: 0 })[0].message, /staff/);
    assert.match(alterationProblems({ pcsAltered: 0, pcsNotRepairable: 2, staffId: 'x' })[0].message, /why/);
    assert.deepEqual(alterationProblems({ pcsAltered: 0, pcsNotRepairable: 2, notRepairableReason: 'Torn', staffId: 'x' }), []);
  });
});

describe('the pipeline - no piece counted twice, none lost', () => {
  test('a worked example', () => {
    // 1,000 in from the units. 950 ironed, 50 damaged: 30 re-iron, 20 rejected
    // (a bag). QC offered 900: 800 approved, 25 Iron, 75 to alteration. The
    // unit altered 45 and could not repair 10 of the 95 it holds; 25 re-iron
    // and 45 altered came back to ironing and were ironed.
    const p = pipeline({
      receivedFromUnits: 1000,
      receivedReIron: 25,
      receivedFromAlteration: 45,
      ironed: 950 + 25 + 45,
      damaged: 50,
      reIroned: 30,
      rejectedAtIroning: 20,
      offered: 900,
      approved: 800,
      qcIron: 25,
      qcToAlteration: 75,
      bagged: 95,
      altered: 45,
      notRepairable: 10,
    });
    assert.equal(Number(p.atIroning), 30);
    assert.equal(Number(p.damageUndecided), 0);
    assert.equal(Number(p.waitingForQc), 120, '50 never offered + 25 re-ironed + 45 altered, all ironed again');
    assert.equal(Number(p.reIronPending), 0);
    assert.equal(Number(p.atAlteration), 40);
    assert.equal(Number(p.alteredPending), 0);
    assert.equal(Number(p.rejected), 10);
    assert.equal(Number(p.accounted), 1000);
    assert.equal(Number(p.difference), 0);
    assert.equal(Number(p.unbagged), 0);
  });

  test('a piece sent back leaves QC and is counted again only where it is received', () => {
    const before = pipeline({
      receivedFromUnits: 100, receivedReIron: 0, receivedFromAlteration: 0,
      ironed: 100, damaged: 0, reIroned: 0, rejectedAtIroning: 0,
      offered: 100, approved: 90, qcIron: 10, qcToAlteration: 0, bagged: 0, altered: 0, notRepairable: 0,
    });
    assert.equal(Number(before.reIronPending), 10);
    assert.equal(Number(before.waitingForQc), 0, 'the 10 left External QC');
    const received = pipeline({
      receivedFromUnits: 100, receivedReIron: 10, receivedFromAlteration: 0,
      ironed: 100, damaged: 0, reIroned: 0, rejectedAtIroning: 0,
      offered: 100, approved: 90, qcIron: 10, qcToAlteration: 0, bagged: 0, altered: 0, notRepairable: 0,
    });
    assert.equal(Number(received.reIronPending), 0);
    assert.equal(Number(received.atIroning), 10, 'now at ironing, once');
    assert.equal(Number(before.difference), 0);
    assert.equal(Number(received.difference), 0);
  });

  test('any flow the services allow adds back up (500 random ones)', () => {
    let seed = 7;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return n <= 0 ? 0 : seed % (n + 1);
    };
    for (let i = 0; i < 500; i += 1) {
      const fromUnits = rnd(5000);
      // A first pass through ironing and QC ...
      const ironed1 = rnd(fromUnits);
      const damaged = rnd(fromUnits - ironed1);
      const reIroned = rnd(damaged);
      const rejectedAtIroning = rnd(damaged - reIroned);
      const offered = rnd(ironed1);
      const approved = rnd(offered);
      const qcIron = rnd(offered - approved);
      const qcToAlteration = offered - approved - qcIron;
      const bagged = qcToAlteration + rejectedAtIroning;
      const altered = rnd(bagged);
      const notRepairable = rnd(bagged - altered);
      // ... and some of what came back, received and ironed again.
      const receivedReIron = rnd(qcIron);
      const receivedFromAlteration = rnd(altered);
      const ironed2 = rnd(receivedReIron + receivedFromAlteration);
      const p = pipeline({
        receivedFromUnits: fromUnits, receivedReIron, receivedFromAlteration,
        ironed: ironed1 + ironed2, damaged, reIroned, rejectedAtIroning,
        offered, approved, qcIron, qcToAlteration, bagged, altered, notRepairable,
      });
      assert.equal(Number(p.difference), 0, `flow ${i}`);
      for (const k of ['atIroning', 'damageUndecided', 'waitingForQc', 'reIronPending', 'atAlteration', 'alteredPending']) {
        assert.ok(Number(p[k]) >= 0, `flow ${i}: ${k} is ${p[k]}`);
      }
    }
  });

  test('a piece sent to alteration but in no bag shows - as the difference', () => {
    const p = pipeline({
      receivedFromUnits: 100, receivedReIron: 0, receivedFromAlteration: 0,
      ironed: 100, damaged: 0, reIroned: 0, rejectedAtIroning: 0,
      offered: 100, approved: 90, qcIron: 0, qcToAlteration: 10, bagged: 9, altered: 0, notRepairable: 0,
    });
    assert.equal(Number(p.unbagged), 1);
    assert.equal(Number(p.difference), -1);
  });
});
