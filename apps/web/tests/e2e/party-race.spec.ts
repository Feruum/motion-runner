import { expect, test, type Page } from '@playwright/test';
import { pose } from '../fixtures';
import type { RaceRoomSnapshot, RaceServerMessage } from '../../../../packages/game/src/core/race-types';
import { RACE_TRACK, obstacleOffset } from '../../../../packages/game/src/core/race-track';

async function syntheticCamera(page: Page, latencyMs = 0) {
  await page.addInitScript(({initial,latencyMs}) => {
    const fixture = { sample: initial }; Object.assign(window,{poseFixture:fixture});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      canvas.getContext('2d')!.fillRect(0,0,640,480);return canvas.captureStream(24);
    }});
    class PoseWorker {
      onmessage:((event:{data:unknown})=>void)|null=null;
      postMessage(message:{type:string;timestampMs:number;bitmap?:ImageBitmap}){
        if(message.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
        if(message.type==='frame'){
          message.bitmap?.close();queueMicrotask(()=>this.onmessage?.({data:{type:'pose',sample:{...fixture.sample,timestampMs:message.timestampMs}}}));
        }
      }
      terminate(){}
    }
    Object.defineProperty(window,'Worker',{value:PoseWorker});
    const OriginalSocket=window.WebSocket;
    class TrackedSocket extends OriginalSocket {
      constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);Object.assign(window,{raceTestSocket:this});}
      override send(data:Parameters<WebSocket['send']>[0]){
        if(!latencyMs){super.send(data);return;}
        setTimeout(()=>{if(this.readyState===OriginalSocket.OPEN)super.send(data);},latencyMs);
      }
    }
    Object.defineProperty(window,'WebSocket',{value:TrackedSocket});
  },{initial:pose(0),latencyMs});
}
async function move(page:Page,lean=0,arms:Parameters<typeof pose>[2]='down',visible=true){
  const sample=pose(0,lean,arms);if(!visible)sample.landmarks=[];
  await page.evaluate(value=>{(window as unknown as {poseFixture:{sample:typeof value}}).poseFixture.sample=value;},sample);
}
async function learn(page:Page){
  await page.getByRole('button',{name:'Enable camera',exact:true}).click();
  const instruction=page.locator('#race-camera-status');
  await expect(instruction).toHaveText('Lean left to steer.');await move(page,-.35);
  await expect(instruction).toContainText('Return to neutral');await move(page);
  await expect(instruction).toHaveText('Lean right to steer.');await move(page,.35);
  await expect(instruction).toContainText('Return to neutral');await move(page);
  await expect(instruction).toHaveText('Raise both hands to jump.');await move(page,0,'up');
  await expect(page.locator('body')).toHaveAttribute('data-camera-stage','ready');await move(page);
}
function watchRoom(page:Page){
  const state:{room:RaceRoomSnapshot|null;id:string;welcomes:number}={room:null,id:'',welcomes:0};
  page.on('websocket',socket=>socket.on('framereceived',frame=>{
    let message:RaceServerMessage;try{message=JSON.parse(String(frame.payload));}catch{return;}
    if(message.type==='welcome'){state.id=message.playerId;state.welcomes++;state.room=message.room;}
    if(message.type==='room')state.room=message.room;
  }));return state;
}

test('offers Party Race from the game picker and plays offline with bots',async({page},testInfo)=>{
  await syntheticCamera(page);await page.goto('.');
  await page.getByRole('button',{name:/Party Race/}).click();
  await page.getByRole('button',{name:'Play with bots',exact:true}).click();
  await expect(page.locator('#race-players li')).toHaveCount(8);
  await learn(page);await page.getByRole('button',{name:'Ready to race',exact:true}).click();
  await page.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-race-phase','racing');
  await expect.poll(async()=>Number(await page.locator('#race-progress').getAttribute('value'))).toBeGreaterThan(4);
  await page.screenshot({path:testInfo.outputPath('offline-race.png')});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('mobile-race.png')});
});

test('two camera players and six bots race through a real room, reconnect and rematch',async({page,browser},testInfo)=>{
  const otherContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const other=await otherContext.newPage();
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));other.on('pageerror',e=>errors.push(e.message));
  const one=watchRoom(page),two=watchRoom(other);
  await Promise.all([syntheticCamera(page),syntheticCamera(other,120)]);
  await page.goto('?mode=party-race');await page.getByLabel('Runner name').fill('Camera One');
  await page.getByRole('button',{name:'Create room',exact:true}).click();
  await expect(page.locator('#race-room-code')).toBeVisible();const code=await page.locator('#race-room-code').textContent();
  await other.goto(`?mode=party-race&room=${code}`);await other.getByLabel('Runner name').fill('Camera Two');
  await other.getByRole('button',{name:'Join room',exact:true}).click();
  await expect(other.locator('#race-players')).toContainText('Camera One');
  await Promise.all([learn(page),learn(other)]);
  await page.getByRole('button',{name:'Ready to race',exact:true}).click();
  await other.getByRole('button',{name:'Ready to race',exact:true}).click();
  await page.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-race-phase','racing');
  await expect(other.locator('body')).toHaveAttribute('data-race-phase','racing');
  expect(one.room!.players.filter(p=>p.isBot)).toHaveLength(6);
  await expect.poll(()=>one.room?.race?.players.find(p=>p.id===one.id)?.z || 0).toBeGreaterThan(8);
  await move(page,0,'down',false);
  await expect(page.locator('#race-tracking-notice')).toContainText('Show your body');
  await page.waitForTimeout(500);
  const stopped=one.room!.race!.players.find(p=>p.id===one.id)!.z;
  const otherBefore=two.room!.race!.players.find(p=>p.id===two.id)!.z;
  await page.waitForTimeout(700);
  expect(one.room!.race!.players.find(p=>p.id===one.id)!.z).toBeCloseTo(stopped,0);
  expect(two.room!.race!.players.find(p=>p.id===two.id)!.z).toBeGreaterThan(otherBefore+2);
  await move(page);
  await page.evaluate(()=>(window as unknown as {raceTestSocket:WebSocket}).raceTestSocket.close());
  await expect.poll(()=>one.welcomes).toBe(2);
  expect(one.room!.code).toBe(code);
  await page.screenshot({path:testInfo.outputPath('online-race.png')});
  const deadline=Date.now()+135000;
  const raised=new Map<Page,number>();
  while(one.room?.phase!=='results'&&Date.now()<deadline){
    await Promise.all([[page,one],[other,two]].map(async pair=>{
      const [target,state]=pair as [Page,typeof one];
      const snapshot=state.room?.race;const player=snapshot?.players.find(p=>p.id===state.id);
      if(!player||!snapshot||player.status!=='racing')return;
      const next=RACE_TRACK.obstacles.find(o=>o.z+o.depth/2>player.z-.5);
      let targetX=0;
      if(next?.kind==='gate'&&next.z-player.z<22)targetX=obstacleOffset(next,snapshot.elapsedMs+Math.max(0,(next.z-player.z)/8*1000));
      const steer=Math.max(-1,Math.min(1,(targetX-player.x)/1.5));
      const lean=Math.abs(steer)<.05?0:-Math.sign(steer)*(.08+Math.abs(steer)*.27);
      // Allow the real gesture filter (smoothing + hands-up hold) and uplink delay to recognize the lift.
      if(next&&(next.kind==='gap'||next.kind==='sweeper')&&next.z-player.z<7&&next.z-player.z>4.8&&player.y<.15&&!raised.has(target))raised.set(target,Date.now());
      const jumpAt=raised.get(target);
      const arms=jumpAt&&Date.now()-jumpAt<650?'up':'down';
      if(jumpAt&&Date.now()-jumpAt>1600)raised.delete(target);
      await move(target,lean,arms);
    }));
    await page.waitForTimeout(65);
  }
  await expect(page.locator('.race-results')).toBeVisible();
  await expect(other.locator('.race-results')).toBeVisible();
  await testInfo.attach('finish-results',{body:JSON.stringify(one.room!.race,null,2),contentType:'application/json'});
  console.log('Party Race finishes',JSON.stringify(one.room!.race!.players.map(p=>({name:p.name,status:p.status,finishMs:p.finishMs,z:p.z}))));
  expect(one.room!.race!.players.filter(p=>!p.isBot).every(p=>p.status==='finished')).toBe(true);
  expect(one.room!.race!.players.map(p=>[p.id,p.rank,p.finishMs])).toEqual(two.room!.race!.players.map(p=>[p.id,p.rank,p.finishMs]));
  await page.screenshot({path:testInfo.outputPath('race-results.png')});
  const hostPage=one.room!.hostId===one.id?page:other;
  await hostPage.getByRole('button',{name:'Race again',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-race-phase','lobby');
  await expect(other.locator('body')).toHaveAttribute('data-race-phase','lobby');
  expect(one.room!.code).toBe(code);
  await page.getByRole('button',{name:'Ready to race',exact:true}).click();
  await other.getByRole('button',{name:'Ready to race',exact:true}).click();
  await hostPage.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-race-phase','racing');
  expect(one.room!.race!.elapsedMs).toBeLessThan(2000);
  expect(errors).toEqual([]);
  await testInfo.attach('network-result',{body:JSON.stringify({room:code,welcomes:one.welcomes,secondPlayerUplinkDelayMs:120,errors}),contentType:'application/json'});
  await otherContext.close();
});
