'use strict';

// CPU の探索を別スレッドで行い、画面を固めない。main.js から { state, opts } を受け取り、
// { lane } を返す。
importScripts('./ai.js');

self.onmessage = (e) => {
  const { state, opts } = e.data;
  const lane = self.SquadroAI.search(state, opts);
  self.postMessage({ lane });
};
