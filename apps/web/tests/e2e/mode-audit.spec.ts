import { test, expect } from '@playwright/test';
import { pose } from '../fixtures';

for (const mode of ['rhythm-run', 'six-seven'] as const) {
  test(`audit ${mode}: scoring, recovery, results and replay`, async ({ page }, testInfo) => {
    test.setTimeout(140_000);
    const errors: string[] = [];
    const report: Record<string, unknown> = { mode };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/leaderboard**', route => route.fulfill({ json: { mode:'classic-run',entries:[],personalBest:null } }));
    await page.addInitScript(initial => {
      const fixture={sample:initial};Object.assign(window,{poseFixture:fixture});
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
    },pose(0));
    const setSample=(sample:ReturnType<typeof pose>)=>page.evaluate(value=>{
      (window as unknown as {poseFixture:{sample:typeof value}}).poseFixture.sample=value;
    },sample);
    const move=(lean=0,arms:Parameters<typeof pose>[2]='down')=>{
      const sample=pose(0,lean,arms);
      if(arms==='left')sample.landmarks[16].y=.65;
      if(arms==='right')sample.landmarks[15].y=.65;
      return setSample(sample);
    };
    await page.goto('.');
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.getByRole('button',{name:'Enable camera'}).click();
    if(mode==='six-seven'){
      await expect(page.getByRole('heading',{name:'Raise your left hand.'})).toBeVisible();
      await move(0,'left');await expect(page.locator('.stage-tutorial')).toContainText('Return to neutral');
      await move();await expect(page.getByRole('heading',{name:'Now raise your right hand.'})).toBeVisible();
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
      await move(0,'left');await page.waitForTimeout(450);
      await move(0,'right');await page.waitForTimeout(450);
      await move(0,'left');await expect(page.locator('#score')).toHaveText('100');
      report.sequenceScore=100;
      await page.waitForTimeout(700);await expect(page.locator('#score')).toHaveText('100');
      report.heldHandDoesNotRepeat=true;
    }else{
      await page.waitForFunction(()=>document.querySelector('#timer')?.textContent==='00:58');
      await expect(page.locator('#mode-cue-title')).toHaveText('GET READY · Lean left');
      await page.waitForFunction(()=>document.querySelector('#mode-cue-title')?.textContent?.includes('MOVE NOW · Lean left'));
      report.promptTimer=await page.locator('#timer').textContent();
      await page.screenshot({path:testInfo.outputPath('move-now.png')});
      await move(-.35);
      await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:2000,intervals:[50]}).toBeGreaterThan(0);
      report.scoreFollowingPrompt=Number(await page.locator('#score').textContent());
      await move();
      await expect(page.locator('#mode-cue-title')).toHaveText('GET READY · Raise both hands');
      await page.waitForFunction(()=>document.querySelector('#mode-cue-title')?.textContent==='MOVE NOW · Raise both hands');
      await move(0,'up');
      await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:2000,intervals:[50]}).toBeGreaterThan(report.scoreFollowingPrompt as number);
      report.scoreFollowingSecondPrompt=Number(await page.locator('#score').textContent());
      await move();
      // Skip the third beat, then follow the next prompt: miss feedback must not hide it.
      await page.waitForFunction(()=>document.querySelector('#mode-cue-title')?.textContent==='MOVE NOW · Lean right');
      await expect(page.locator('#mode-cue-title')).toHaveText('Wait for the next cue, then move with the beat.');
      await expect(page.locator('#mode-cue-title')).toHaveText('GET READY · Raise both hands');
      await page.waitForFunction(()=>document.querySelector('#mode-cue-title')?.textContent==='MOVE NOW · Raise both hands');
      await move(0,'up');
      await expect.poll(async()=>Number(await page.locator('#score').textContent()),{timeout:2000,intervals:[50]}).toBeGreaterThan(report.scoreFollowingSecondPrompt as number);
      report.scoreAfterMiss=Number(await page.locator('#score').textContent());
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
    await page.screenshot({path:testInfo.outputPath('results.png')});
    if(mode==='six-seven'){
      await move(0,'up');await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');await move();
    }else await page.getByRole('button',{name:'Run again'}).click();
    await expect(page.locator('body')).toHaveAttribute('data-stage','COUNTDOWN');
    await expect(page.locator('#score')).toHaveText('000');
    await expect(page.locator('body')).toHaveAttribute('data-stage','PLAYING');report.replay=true;
    expect(errors).toEqual([]);report.errors=errors;
    await testInfo.attach('audit-report',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    console.log(JSON.stringify(report));
  });
}
