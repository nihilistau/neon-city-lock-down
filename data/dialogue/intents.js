// @ts-check
// Global intent lexicon. Registered once at boot; topics trigger off these ids.
import { registerIntents } from '../../src/dialogue/parser/intents.js';

registerIntents([
  { id: 'greet', keywords: ['hi', 'hey', 'hello', 'yo', 'sup', 'hail'], phrases: ['good evening', 'whats up'], base: 0.5 },
  { id: 'howareyou', phrases: ['how are you', 'you okay', 'you alright', 'how do you feel', 'you good'], keywords: ['okay', 'alright'], base: 0.5 },
  { id: 'name', phrases: ['your name', 'who are you', 'what are you called'], keywords: ['name'] },
  { id: 'compliment', weighted: [['beautiful', 2], ['gorgeous', 2], ['stunning', 2], ['pretty', 1.5], ['cute', 1.5], ['hot', 1.5], ['amazing', 1], ['incredible', 1], ['smart', 1], ['impressive', 1.5]], phrases: ['you look', 'i like you'] },
  { id: 'insult', weighted: [['stupid', 2], ['idiot', 2], ['pathetic', 2], ['weak', 1.5], ['coward', 2], ['ugly', 1.5], ['useless', 2], ['bitch', 1.5]], phrases: ['shut up', 'you suck'] },
  { id: 'threaten', weighted: [['kill', 2.5], ['shoot', 2], ['hurt', 1.5], ['threat', 2], ['gun', 1], ['die', 1.5]], phrases: ['ill kill', 'or else', 'watch yourself', 'dont test me'] },
  { id: 'flirt', weighted: [['kiss', 2], ['want', 1], ['desire', 2], ['tease', 1.5], ['sexy', 2], ['bed', 1.5], ['touch', 1.5], ['closer', 1.5], ['naughty', 2]], phrases: ['come here', 'come closer', 'take off', 'get closer'] },
  { id: 'escalate', weighted: [['more', 1], ['further', 2], ['dont stop', 2], ['keep going', 2], ['harder', 2], ['now', 0.5]], phrases: ['push further', 'go further', 'dont stop'] },
  { id: 'backoff', keywords: ['stop', 'no', 'wait', 'enough', 'slow'], phrases: ['back off', 'slow down', 'not yet', 'give me space'], base: 0.5 },
  { id: 'ask_past', phrases: ['your past', 'your story', 'where are you from', 'who were you', 'tell me about yourself', 'your job', 'what do you do'], keywords: ['backstory', 'history', 'fixer'] },
  { id: 'ask_lockdown', keywords: ['lockdown', 'riot', 'outside', 'city', 'curfew', 'trapped', 'siege'], phrases: ['out there', 'the streets', 'whats happening'] },
  { id: 'ask_plan', phrases: ['what now', 'the plan', 'what do we do', 'how do we get out', 'whats the plan'], keywords: ['plan', 'escape', 'leave'] },
  { id: 'ask_supplies', keywords: ['food', 'water', 'ammo', 'supplies', 'drink', 'hungry', 'thirsty', 'whiskey', 'booze'], phrases: ['anything to eat', 'a drink'] },
  { id: 'offer_drink', phrases: ['have a drink', 'get you a drink', 'pour you', 'want a drink'], keywords: ['cheers'] },
  { id: 'trust', keywords: ['trust', 'believe', 'honest', 'truth'], phrases: ['trust you', 'trust me', 'be honest', 'tell me the truth'] },
  { id: 'agree', keywords: ['yes', 'yeah', 'sure', 'okay', 'fine', 'deal', 'agreed'], base: 0.4 },
  { id: 'refuse', keywords: ['no', 'nope', 'never', 'refuse'], base: 0.4 },
  { id: 'command', weighted: [['do', 0.5], ['obey', 2], ['kneel', 2], ['strip', 2], ['sit', 1], ['stand', 1], ['come', 1], ['dance', 1.5]], phrases: ['do it', 'right now', 'i said'] },
  { id: 'apologize', keywords: ['sorry', 'apologize', 'apology', 'forgive'], phrases: ['my bad', 'i apologize'] },
  { id: 'joke', keywords: ['joke', 'funny', 'haha', 'lol', 'lmao'], phrases: ['thats funny'] },
  { id: 'about_lola', weighted: [['lola', 3], ['voss', 2]], phrases: ['about lola', 'think of lola'] },
  { id: 'about_aria', weighted: [['aria', 3], ['chen', 2]], phrases: ['about aria', 'think of aria'] },
  { id: 'about_kai', weighted: [['kai', 3], ['mercer', 2]], phrases: ['about kai', 'think of kai'] },
  { id: 'about_vox', weighted: [['vox', 3], ['building', 1.5], ['tower', 1]], phrases: ['about vox', 'the building', 'this tower'] },
]);
