import { test, expect } from '@playwright/test';
import { pose } from '../fixtures';

for (const mode of ['rhythm-run', 'six-seven'] as const) {
  test(`audit ${mode}: scoring, recovery, results and replay`, async ({ page }, testInfo) => {
    test.setTimeout(140_000);
    const errors: string[] = [];
    const report: Record<string, unknown> = { mode };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/leaderboard**', route => route.fulfill({ json: { mode:'classic-run',entries:[],personalBest:null } }));
    await page.addInitScript(({sample, initialMode}) => {
      if(initialMode==='six-seven')localStorage.setItem('motion-runner-best:v2:six-seven','100');
      const fixture={sample};Object.assign(window,{poseFixture:fixture});
      if(initialMode==='rhythm-run'){
        const timeline:Array<Record<string,unknown>>=[];Object.assign(window,{rhythmTimeline:timeline});
        let lastCue='',lastVisibility=false,lastCollected='0',lastProgress='';
        const recordCue=()=>{
          const title=document.querySelector('#mode-cue-title')?.textContent?.trim()??'';
          const cue=document.querySelector<HTMLElement>('#mode-cue');
          const style=cue?getComputedStyle(cue):null;
          const visible=!!cue&&!cue.hidden&&style?.display!=='none'&&style?.visibility==='visible'&&cue.getClientRects().length>0;
          const world=document.querySelector('#game-world');
          const state={atMs:performance.now(),title,timer:document.querySelector('#timer')?.textContent,
            starId:world?.getAttribute('data-rhythm-next-id'),starAtMs:world?.getAttribute('data-rhythm-next-at'),
            starZ:world?.getAttribute('data-rhythm-next-z'),score:document.querySelector('#score')?.textContent,
            collected:world?.getAttribute('data-rhythm-collected')};
          if(title&&(title!==lastCue||(visible&&!lastVisibility))){lastCue=title;timeline.push({kind:'cue',visible,...state});}
          lastVisibility=visible;
          const collected=state.collected??'0';
          if(collected!==lastCollected){lastCollected=collected;timeline.push({kind:'collect',...state});}
          if(title==='Reach the high star · jump in progress'&&title!==lastProgress){lastProgress=title;timeline.push({kind:'jump-progress',...state});}
          if(title!=='Reach the high star · jump in progress')lastProgress='';
        };
        new MutationObserver(recordCue).observe(document,{childList:true,subtree:true,characterData:true});
        const sampleCue=()=>{recordCue();requestAnimationFrame(sampleCue);};requestAnimationFrame(sampleCue);
      }
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        canvas.getContext('2d')!.fillRect(0,0,640,480);return canvas.captureStream(24);
      }});
      class PoseWorker {
        onmessage: ((event:{data:unknown})=>void)|null=null;
        postMessage(message:{type:string;timestampMs:number;bitmap?:ImageBitmap}){
          if(message.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
          if(message.type==='frame'){
            message.bitmap?.close();queueMicrotask(()=>this.onmessage?.({data:{type:'pose',sample:{...fixture.sample,timestampMs:message.timestampMs}}}));
          }
        }
        terminate(){}
      }
      Object.defineProperty(window,'Worker',{value:PoseWorker});
    },{sample:pose(0),initialMode:mode});
    const setSample=(sample:ReturnType<typeof pose>)=>page.evaluate(value=>{
      (window as unknown as {poseFixture:{sample:typeof value}}).poseFixture.sample=value;
    },sample);
    const move=(lean=0,arms:Parameters<typeof pose>[2]='down')=>{
      const sample=pose(0,lean,arms);
      if(arms==='left')sample.landmarks[16].y=.65;
      if(arms==='right')sample.landmarks[15].y=.65;
      if(mode==='six-seven'&&(arms==='left'||arms==='right')){
        sample.landmarks[13].y=sample.landmarks[14].y=.59;
        sample.landmarks[15].y=arms==='left'?.48:.62;
        sample.landmarks[16].y=arms==='right'?.48:.62;
      }
      return setSample(sample);
    };
    await page.goto('.');
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.getByRole('button',{name:'Enable camera'}).click();
    if(mode==='six-seven'){
      await expect(page.getByRole('heading',{name:'Lift your left hand higher.'})).toBeVisible();
      await move(0,'left');await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
      await move();await expect(page.getByRole('heading',{name:'Now lift your right hand higher.'})).toBeVisible();
      await move(0,'right');
    }else{
      await expect(page.getByRole('heading',{name:'Lean into the left lane.'})).toBeVisible();
      await move(-.35);await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
      await move();await expect(page.getByRole('heading',{name:'Now find the right lane.'})).toBeVisible();
      await move(.35);await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
      await move();await expect(page.getByRole('heading',{name:'Lift off with both hands.'})).toBeVisible();
      await move(0,'up');
    }
    await expect(page.locator('.stage-ready')).toBeVisible();
    await move(0,'up');await expect(page.getByRole('heading',{name:'Great. Hands down.'})).toBeVisible();
    await move();await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
    report.start=true;
    if(mode==='six-seven'){
      await move(0,'left');await expect(page.locator('#mode-cue-title')).toContainText('1/2');
      await move(0,'right');await expect(page.locator('#score')).toHaveText('1');
      report.repetitionsAfterTwoMovements=1;
      await page.waitForTimeout(700);await expect(page.locator('#score')).toHaveText('1');
      report.heldHandDoesNotRepeat=true;
      await move(0,'left');await expect(page.locator('#mode-cue-title')).toContainText('1/2');
      await expect(page.locator('#score')).toHaveText('1');
      await move(0,'right');await expect(page.locator('#score')).toHaveText('2');
      report.repetitionsAfterFourMovements=2;
    }else{
      const lowAction=await respondToRhythmCue(page,'Lean left · collect the low star',pose(0,-.35),350,'lean-left');
      report.firstPromptResponse=lowAction;
      await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:4000,intervals:[50]}).toBeGreaterThan(0);
      report.scoreFollowingPrompt=Number(await page.locator('#score').textContent());
      await move();
      const firstJump=pose(0,0,'up');
      report.firstJumpResponse=await respondToRhythmCue(page,'Raise both hands · jump for the star',firstJump,350,'jump-star-2');
      try {
        await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:2000,intervals:[50]}).toBeGreaterThan(report.scoreFollowingPrompt as number);
      } catch(error) {
        report.rhythmTimeline=await page.evaluate(()=>((window as unknown as {rhythmTimeline:Array<Record<string,unknown>>}).rhythmTimeline));
        await testInfo.attach('rhythm-timing-diagnostic',{body:JSON.stringify(report,null,2),contentType:'application/json'});
        throw error;
      }
      report.scoreFollowingSecondPrompt=Number(await page.locator('#score').textContent());
      await move();
      // Skip the third beat, then follow the next prompt: miss feedback must not hide it.
      await expect(page.locator('#game-world')).toHaveAttribute('data-rhythm-next-id','3');
      const recoveryJump=pose(0,0,'up');
      report.jumpAfterMissResponse=await respondToRhythmCue(page,'Raise both hands · jump for the star',recoveryJump,350,'jump-star-4-after-miss');
      try {
        await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:2000,intervals:[50]}).toBeGreaterThan(report.scoreFollowingSecondPrompt as number);
      } catch(error) {
        report.rhythmTimeline=await page.evaluate(()=>((window as unknown as {rhythmTimeline:Array<Record<string,unknown>>}).rhythmTimeline));
        await testInfo.attach('rhythm-timing-diagnostic',{body:JSON.stringify(report,null,2),contentType:'application/json'});
        throw error;
      }
      report.scoreAfterMiss=Number(await page.locator('#score').textContent());
      report.rhythmTimeline=await page.evaluate(()=>((window as unknown as {rhythmTimeline:Array<Record<string,unknown>>}).rhythmTimeline).filter(event=>event.kind==='cue'||event.kind==='action'||event.kind==='jump-progress'||event.kind==='collect'));
      await page.screenshot({path:testInfo.outputPath('rhythm-after-actions.png')});
    }
    await move();
    const clipped=pose(0);clipped.landmarks[15].visibility=.1;
    await setSample(clipped);await expect(page.locator('#camera-status')).toContainText('HANDS OUT OF VIEW');
    await page.waitForTimeout(500);await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
    report.clippedWristContinues=true;
    const missing={...pose(0),landmarks:[]};await setSample(missing);
    await expect(page.locator('.stage-paused')).toBeVisible();
    const score=await page.locator('#score').textContent(),timer=await page.locator('#timer').textContent();
    await page.waitForTimeout(400);await expect(page.locator('#timer')).toHaveText(timer!);
    await move();await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');
    await expect(page.locator('#score')).toHaveText(score!);report.recoveryPreservesScore=true;
    await expect(page.locator('.stage-results')).toBeVisible({timeout:70000});report.results=true;
    if(mode==='six-seven'){
      const metrics=page.locator('.results-metrics[data-mode="six-seven"] > div');
      await expect(metrics.filter({hasText:'REPETITIONS'}).locator('strong')).toHaveText('2');
      await expect(metrics.filter({hasText:'PERSONAL BEST'}).locator('strong')).toHaveText('2');
      await expect(page.locator('.stage-results')).toContainText('PERSONAL BEST 2 REPS');
      report.oldPointBestIgnored=true;
    }
    await page.screenshot({path:testInfo.outputPath('results.png')});
    if(mode==='six-seven'){
      await move(0,'up');await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');await move();
    }else await page.getByRole('button',{name:'Run again'}).click();
    await expect(page.locator('body')).toHaveAttribute('data-stage','COUNTDOWN');
    await expect(page.locator('#score')).toHaveText(mode==='six-seven'?'0':'000');
    await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');report.replay=true;
    expect(errors).toEqual([]);report.errors=errors;
    await testInfo.attach('audit-report',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    console.log(JSON.stringify(report));
  });
}

async function respondToRhythmCue(
  page: import('@playwright/test').Page,
  title: string,
  sample: ReturnType<typeof pose>,
  reactionMs: number,
  label: string,
) {
  return page.evaluate(async ({title,sample,reactionMs,label})=>{
    const timeline=(window as unknown as {rhythmTimeline:Array<Record<string,unknown>>}).rhythmTimeline;
    const read=()=>{
      const cue=document.querySelector<HTMLElement>('#mode-cue');
      const style=cue?getComputedStyle(cue):null;
      const cueVisible=!!cue&&!cue.hidden&&style?.display!=='none'&&style?.visibility==='visible'&&cue.getClientRects().length>0;
      const world=document.querySelector('#game-world');
      const starAtMs=Number(world?.getAttribute('data-rhythm-next-at'));
      const starZ=Number(world?.getAttribute('data-rhythm-next-z'));
      const msToStar=Number.isFinite(starAtMs)&&Number.isFinite(starZ)?3000-((starZ+14)/14*3000):null;
      return {timer:document.querySelector('#timer')?.textContent,score:document.querySelector('#score')?.textContent,
        starId:world?.getAttribute('data-rhythm-next-id'),starAtMs,starZ,msToStar,cueVisible};
    };
    const cueAtMs=await new Promise<number>((resolve,reject)=>{
      let settled=false,observer:MutationObserver,rafId=0,timeoutId=0;
      const finish=(atMs:number)=>{if(settled)return;settled=true;observer.disconnect();cancelAnimationFrame(rafId);clearTimeout(timeoutId);resolve(atMs);};
      const matches=()=>{
        const cue=document.querySelector<HTMLElement>('#mode-cue');
        const titleNode=document.querySelector('#mode-cue-title');
        const style=cue?getComputedStyle(cue):null;
        return !!cue&&!cue.hidden&&style?.display!=='none'&&style?.visibility==='visible'&&cue.getClientRects().length>0&&titleNode?.textContent?.trim()===title;
      };
      observer=new MutationObserver(()=>{if(matches())finish(performance.now());});
      observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style']});
      const startedAt=performance.now();
      timeoutId=window.setTimeout(()=>{observer.disconnect();cancelAnimationFrame(rafId);if(!settled){settled=true;reject(new Error(`Visible Rhythm cue timed out: ${title}; waited ${Math.round(performance.now()-startedAt)}ms`));}},10_000);
      const check=()=>{if(matches())finish(performance.now());else rafId=requestAnimationFrame(check);};check();
    });
    const before=read();
    await new Promise(resolve=>setTimeout(resolve,reactionMs));
    const actionAtMs=performance.now();
    const fixture=(window as unknown as {poseFixture:{sample:typeof sample}}).poseFixture;
    fixture.sample=sample;
    const action={kind:'action',label,title,cueAtMs,actionAtMs,reactionMs:actionAtMs-cueAtMs,before};
    timeline.push(action);
    return action;
  },{title,sample,reactionMs,label});
}
