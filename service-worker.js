const t="network-or-cache";self.addEventListener("install",e=>{e.waitUntil(caches.open(t).then(t=>t.addAll(["./","index.html","style.css","main.js","api.json","assets/logo.svg","assets/lines.svg","roboto/Roboto-Regular.ttf","roboto/Roboto-Medium.ttf"])))}),self.addEventListener("fetch",e=>{e.respondWith(function(t,e){return new Promise((n,o)=>{const s=setTimeout(o,e);fetch(t).then(t=>{clearTimeout(s),n(t)},o)})}(e.request,400).catch(()=>(function(e){return caches.open(t).then(t=>t.match(e)).then(t=>{if(t)return t;throw new Error("no-match")})})(e.request)))});
//# sourceMappingURL=service-worker.js.map
