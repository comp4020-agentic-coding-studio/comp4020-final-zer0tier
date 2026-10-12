import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { baseUrl, freshId, post, signUp } from './helpers.ts';
it('fight:finished delivers the same saved Claw Strike battle to both windows within 1s', async () => {
  const attacker = freshId(), defender = freshId();
  await signUp(attacker); await signUp(defender);
  const sockets = await Promise.all([0,1].map(() => new Promise<WebSocket>((resolve) => {
    const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws');
    ws.once('open', () => resolve(ws));
  })));
  try {
    const received = sockets.map(ws => new Promise<any>((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('no fight:finished within 1s')),1000);
      ws.on('message', raw => { const event=JSON.parse(String(raw));
        if(event.type==='fight:finished' && event.fight.attacker===attacker) {clearTimeout(timer);resolve(event.fight);}
      });
    }));
    const res = await post(`/api/pets/${attacker}/fight/${defender}`);
    expect(res.status).toBe(200);
    const { fight } = await res.json();
    expect(fight.battle.fighters.map((f: any)=>[f.maxHp,f.maxMp])).toEqual([[15,5],[15,5]]);
    expect(fight.battle.winner).toBe(fight.winner);
    // The pre-battle coin toss is saved: heads means the attacker struck first.
    expect(fight.battle.initiative).toEqual({ toss: expect.stringMatching(/^(heads|tails)$/), coin: null });
    expect(fight.battle.turns[0].actor).toBe(fight.battle.initiative.toss === 'heads' ? 0 : 1);
    for(const result of await Promise.all(received)) expect(result).toEqual(fight);
    for(const id of [attacker,defender]) {
      const history=await (await fetch(new URL(`/api/pets/${id}/fights`,baseUrl))).json();
      expect(history[0]).toEqual(fight);
    }
  } finally {sockets.forEach(ws=>ws.close());}
});
