import { buildPreflopStory } from './src/renderer/src/lib/postflopAdvisor'
function show(label:string,f:any){console.log(`\n━━ ${label} ━━`);console.log('  '+buildPreflopStory(f).join('\n  '))}
show('AA open UTG', {position:'UTG',scenario:'rfi',heroKey:'AA',chart:'raise',eq:0.85,raiseToBB:0,vsJam:false,effBB:100,inPosition:false,reshove:false})
show('AKs 3bet vs open BTN', {position:'BTN',scenario:'vsopen',heroKey:'AKs',chart:'3bet',eq:0.62,raiseToBB:2.5,vsJam:false,effBB:100,inPosition:true,reshove:false})
show('A5s 3bet-bluff vs open', {position:'CO',scenario:'vsopen',heroKey:'A5s',chart:'3bet',eq:0.44,raiseToBB:2.5,vsJam:false,effBB:100,inPosition:true,reshove:false})
show('76s call vs open BTN', {position:'BTN',scenario:'vsopen',heroKey:'76s',chart:'call',eq:0.40,raiseToBB:2.5,vsJam:false,effBB:100,inPosition:true,reshove:false})
show('72o fold UTG', {position:'UTG',scenario:'rfi',heroKey:'72o',chart:'fold',eq:0.30,raiseToBB:0,vsJam:false,effBB:100,inPosition:false,reshove:false})
show('A9s squeeze-jam 12bb', {position:'BTN',scenario:'squeeze',heroKey:'A9s',chart:'raise',eq:0.5,raiseToBB:4,vsJam:false,effBB:12,inPosition:true,reshove:true})
