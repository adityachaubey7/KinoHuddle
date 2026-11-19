// Stand-in for https://www.youtube.com/iframe_api inside the sandbox (YouTube is unreachable here).
// Implements the subset of the IFrame Player API that SyncSpace uses, with a real clock.
(function () {
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  class Player {
    constructor(el, opts) {
      this.opts = opts; this.state = S.UNSTARTED; this.base = 0; this.since = 0; this.rate = 1; this.vid = null; this.dur = window.__MOCK_DUR || 634;
      const node = typeof el === 'string' ? document.getElementById(el) : el;
      this.el = document.createElement('div');
      this.el.style.cssText = 'position:absolute;inset:0;background:#000 center/cover no-repeat;display:grid;place-items:end start;';
      this.label = document.createElement('div');
      this.label.style.cssText = 'margin:14px;padding:4px 10px;background:rgba(0,0,0,.6);color:#fff;font:600 13px monospace;border-radius:6px';
      this.el.appendChild(this.label); node.replaceWith(this.el);
      window.__players = (window.__players || []).concat(this);
      this.timer = setInterval(() => { if (this.state === S.PLAYING && this.vid && this.getCurrentTime() >= this.dur) { this.base = this.dur; this._emit(S.ENDED); }
        this.label.textContent = `mock YouTube ${this.vid} ${this.getCurrentTime().toFixed(1)}s ${['ended','playing','paused','buffering','','cued'][this.state] || 'unstarted'}`; }, 200);
      setTimeout(() => opts.events?.onReady?.({ target: this }), 50);
    }
    _emit(s) { this.state = s; this.opts.events?.onStateChange?.({ target: this, data: s }); }
    _load(v, start) { this.vid = v; this.base = start || 0; this.since = performance.now(); this.el.style.backgroundImage = `url(https://i.ytimg.com/vi/${v}/maxresdefault.jpg)`; }
    loadVideoById(o) { this._load(o.videoId, o.startSeconds); this._emit(S.BUFFERING); setTimeout(() => this.playVideo(), 300); }
    cueVideoById(o) { this._load(o.videoId, o.startSeconds); this._emit(S.CUED); }
    playVideo() { if (this.state === S.PLAYING) return; this.base = this.getCurrentTime(); this.since = performance.now(); this._emit(S.PLAYING); }
    pauseVideo() { if (this.state !== S.PLAYING) return; this.base = this.getCurrentTime(); this._emit(S.PAUSED); }
    seekTo(t) { this.base = t; this.since = performance.now(); }
    getCurrentTime() { return this.state === S.PLAYING ? this.base + (performance.now() - this.since) / 1000 * this.rate : this.base; }
    getDuration() { return this.vid ? this.dur : 0; }
    getPlayerState() { return this.state; }
    setPlaybackRate(r) { this.base = this.getCurrentTime(); this.since = performance.now(); this.rate = r; }
    getPlaybackRate() { return this.rate; }
    setVolume() {} mute() {} unMute() {}
    destroy() { clearInterval(this.timer); this.el.remove(); }
  }
  window.YT = { Player, PlayerState: S };
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
})();
