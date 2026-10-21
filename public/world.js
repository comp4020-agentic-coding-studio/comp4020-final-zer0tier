// The home and town are a presentation layer. Keep the original gameplay
// controls (and their listeners) alive; app.js owns every saved pet update.
const worldById = (id) => document.getElementById(id);
const worldDashboard = worldById('dashboard');
const original = {
  hero: worldDashboard.querySelector('.pet-hero'),
  play: worldDashboard.querySelector('.play'),
  stats: worldDashboard.querySelector('.stats'),
  school: worldDashboard.querySelector('.school'),
  study: worldById('study-heading').closest('section'),
  work: worldById('work-heading').closest('section'),
  arena: worldById('arena-heading').closest('section'),
  supplies: worldById('care-heading').closest('section'),
  adventure: worldById('adventure-heading').closest('section'),
};
const worldShell = document.createElement('div');
worldShell.id = 'world-shell';
worldShell.dataset.scene = 'home';
worldShell.innerHTML = `
  <header class="world-heading">
    <div class="world-title"><p class="world-eyebrow" id="world-eyebrow">A PLACE TO CALL YOUR OWN</p>
      <h1 id="world-title" tabindex="-1">Home, sweet home.</h1>
      <p id="world-description">A warm fire, a familiar face, and a little time together.</p></div>
    <div class="world-heading-actions"><button type="button" id="world-map" class="world-button">Town map <span aria-hidden="true">↗</span></button></div>
  </header>
  <div class="world-layout">
    <div class="world-main">
      <div id="world-stage" class="world-stage" data-scene="home" tabindex="0" role="group" aria-label="Your home. Move with W A S D or arrow keys. Press Space near an object to interact." aria-describedby="home-controls-tip">
        <div id="home-scene">
          <img class="scene-art" src="/scenes/home.svg" alt="A cozy wooden room with a television, couch, fireplace, pet house, food bowl, bathtub, storage chest, wall clock, and a door leading into town." draggable="false" />
          <!-- Local ambient details stay aligned to the original 960 × 640 room artwork. -->
          <svg class="scene-effect" data-effect="fire" aria-hidden="true" focusable="false" viewBox="713 135 74 58" style="--effect-x:74.270833%; --effect-y:21.09375%; --effect-w:7.708333%; --effect-h:9.0625%">
            <defs>
              <clipPath id="env-home-hearth-clip"><path d="M713 193v-31a37 27 0 0 1 74 0v31Z"/></clipPath>
              <linearGradient id="env-home-fire-color" x2="0" y2="1"><stop stop-color="#ffd87e"/><stop offset=".55" stop-color="#ee9a43"/><stop offset="1" stop-color="#b95332"/></linearGradient>
              <radialGradient id="env-home-ember-color"><stop stop-color="#ef9d4f" stop-opacity=".68"/><stop offset="1" stop-color="#cc6937" stop-opacity="0"/></radialGradient>
            </defs>
            <g clip-path="url(#env-home-hearth-clip)">
              <path d="M713 193v-31a37 27 0 0 1 74 0v31Z" fill="#3b3430"/>
              <path d="M713 183h74v10h-74Z" fill="#8f4b32"/>
              <ellipse cx="750" cy="179" rx="38" ry="20" fill="url(#env-home-ember-color)"/>
              <path class="ambient-motion env-home-flame-outer" d="M725 185c-12-17 4-23 4-37 10 7 8 14 10 19 2-15 16-21 12-35 18 12 8 22 18 33 3-8 7-8 7-14 14 14 14 24 1 34Z" fill="url(#env-home-fire-color)"/>
              <path class="ambient-motion env-home-flame-inner" d="M738 185c-11-10 0-18 0-27 8 6 4 9 10 13 6-8 3-17 9-24 2 14 14 20 11 29-1 4-5 7-7 9Z" fill="#ffd37a"/>
              <path class="ambient-motion env-home-flame-heart" d="M745 185c-5-6 4-11 6-19 0 9 10 11 7 19Z" fill="#fff0b0"/>
              <g class="ambient-motion env-home-embers" fill="#ffdf8b" opacity=".65"><circle cx="734" cy="168" r=".8"/><circle cx="760" cy="160" r=".7"/><circle cx="750" cy="147" r=".6"/></g>
              <path d="m720 185 53 5m-49 3 53-11" fill="none" stroke="#594334" stroke-width="6" stroke-linecap="round"/>
              <path d="m723 183 47 5m-42 3 46-9" fill="none" stroke="#b47743" stroke-width="1.5"/>
              <path d="M723 197v-7m53 7v-7m-50 3h48" fill="none" stroke="#423c34" stroke-width="3"/>
              <circle cx="737" cy="187" r="1.5" fill="#ffbd60"/><circle cx="760" cy="186" r="1.2" fill="#ffd080"/>
            </g>
          </svg>
          <svg class="scene-effect" data-effect="tv" aria-hidden="true" focusable="false" viewBox="179 105 70 41" style="--effect-x:18.645833%; --effect-y:16.40625%; --effect-w:7.291667%; --effect-h:6.40625%">
            <defs>
              <clipPath id="env-home-tv-clip"><rect x="179" y="105" width="70" height="41" rx="6"/></clipPath>
              <linearGradient id="env-home-tv-sky" x2=".8" y2="1"><stop stop-color="#c4d8c2"/><stop offset=".45" stop-color="#9ebfab"/><stop offset="1" stop-color="#587f73"/></linearGradient>
              <linearGradient id="env-home-tv-glass" x2="1" y2="0"><stop stop-color="#f4f6d9" stop-opacity=".1"/><stop offset=".45" stop-color="#f4f6d9" stop-opacity=".7"/><stop offset="1" stop-color="#f4f6d9" stop-opacity="0"/></linearGradient>
            </defs>
            <g clip-path="url(#env-home-tv-clip)">
              <rect x="179" y="105" width="70" height="41" fill="url(#env-home-tv-sky)"/>
              <circle cx="235" cy="114" r="4.3" fill="#e2dca7" opacity=".88"/>
              <g class="ambient-motion env-home-tv-clouds" fill="#edf0d7" opacity=".72"><path d="M181 115c-2-3 2-5 4-4 0-5 8-6 10-1 4-2 9 2 6 5Z"/><path d="M217 111c-1-2 2-4 4-3 2-4 7-3 8 0 4-1 6 2 4 3Z"/></g>
              <path d="m171 139 23-17 13 9 14-18 19 18 17-12v29h-86Z" fill="#698b72"/>
              <path d="m221 113-7 9 7-3 4 3Z" fill="#b4c3a2" opacity=".7"/>
              <g class="ambient-motion env-home-tv-meadow"><path d="M172 139q20-14 41-3t45-5v18h-86Z" fill="#9ab28a"/><path d="M171 144q22-9 42-3t45-2v10h-87Z" fill="#83a17c"/><path d="M224 136q-6 2-3 5t-5 7" fill="none" stroke="#c8cfab" stroke-width="2.4" opacity=".8"/></g>
              <path class="ambient-motion env-home-tv-reflection" d="M185 106h34l-28 40h-18Z" fill="url(#env-home-tv-glass)" opacity=".2"/>
              <path d="M183 116h61m-62 12h64m-62 12h60" fill="none" stroke="#e6efdb" stroke-width=".5" opacity=".12"/>
              <rect x="179.5" y="105.5" width="69" height="40" rx="5.5" fill="none" stroke="#335e58" stroke-width="1" opacity=".25"/>
            </g>
          </svg>
          <svg class="scene-effect" data-effect="bath" aria-hidden="true" focusable="false" viewBox="748 455 119 22" style="--effect-x:77.916667%; --effect-y:71.09375%; --effect-w:12.395833%; --effect-h:3.4375%">
            <defs><clipPath id="env-home-bath-clip"><ellipse cx="807.5" cy="466" rx="59" ry="11"/></clipPath></defs>
            <g clip-path="url(#env-home-bath-clip)" fill="none" stroke="#f0f7e7" stroke-linecap="round">
              <g class="ambient-motion env-home-bath-ripple" opacity=".4" stroke-width=".8"><ellipse cx="831" cy="460" rx="10" ry="2.6"/><path d="M777 470q12 3 25 0"/></g>
              <g class="ambient-motion env-home-bath-ripple env-home-bath-ripple-late" opacity=".4" stroke-width=".75"><ellipse cx="831" cy="460" rx="10" ry="2.6"/><path d="M777 470q12 3 25 0"/></g>
              <path class="ambient-motion env-home-bath-glint" d="M754 467q8 2 15 0m35-5 9-1m25 9q9-1 14-3" stroke-width=".9" opacity=".45"/>
            </g>
          </svg>
          <svg id="home-interaction-outline" viewBox="0 0 960 640" aria-hidden="true" focusable="false" hidden>
            <use class="interaction-outline-edge" />
            <use class="interaction-outline-light" />
          </svg>
          <button type="button" class="home-hotspot" data-home-action="tv" style="--x:22.8%;--y:25.4%;--w:15%;--h:21%" aria-label="Watch the television: town journal"><span class="hotspot-label">Town TV</span></button>
          <button type="button" class="home-hotspot" data-home-action="couch" style="--x:22.9%;--y:50%;--w:19%;--h:18%" aria-label="Sit on the couch with your pet"><span class="hotspot-label">Take a breather</span></button>
          <button type="button" class="home-hotspot" data-home-action="fire" style="--x:77.6%;--y:25%;--w:17%;--h:22%" aria-label="Warm up by the fireplace"><span class="hotspot-label">Cozy fireplace</span></button>
          <button type="button" class="home-hotspot" data-home-action="bed" style="--x:78.1%;--y:49%;--w:17%;--h:20%" aria-label="Pet's little home: customize appearance"><span class="hotspot-label">Your pet's nook</span></button>
          <button type="button" class="home-hotspot" data-home-action="feed" style="--x:67.7%;--y:64.1%;--w:10%;--h:10%" aria-label="Food bowl: feed your pet"><span class="hotspot-label">Food bowl</span></button>
          <button type="button" class="home-hotspot" data-home-action="clean" style="--x:85.4%;--y:75%;--w:16%;--h:16%" aria-label="Bath: clean your pet"><span class="hotspot-label">Bath time</span></button>
          <button type="button" class="home-hotspot" data-home-action="chest" style="--x:38.1%;--y:75%;--w:9%;--h:9%" aria-label="Storage chest: backpack and battle skills"><span class="hotspot-label">Backpack &amp; skills</span></button>
          <button type="button" class="home-hotspot" data-home-action="menu" style="--x:37%;--y:14.1%;--w:7%;--h:10%" aria-label="Wall clock: game menu and sign out"><span class="hotspot-label">Game menu</span></button>
          <button type="button" class="home-hotspot" data-home-action="pet" data-place="pet" style="--x:50%;--y:55%;--w:13%;--h:16%" aria-label="Spend time with your pet: care and details"><span class="hotspot-label">Your companion</span></button>
          <button type="button" id="home-door" class="home-hotspot" data-home-action="door" style="--x:50%;--y:91%;--w:15%;--h:14%" aria-label="Leave home for the town map"><span class="hotspot-label">Go to town ↗</span></button>
          <span class="home-pet-label" id="home-pet-label">Your companion</span>
        </div>
        <div id="town-scene" hidden>
          <img class="scene-art" src="/scenes/town.svg" alt="A warm illustrated village with tiled roofs, leafy gardens, a fountain, and a riverside footbridge. Winding paths connect the shops, school, job board, arena, your home, and woodland adventure trail." draggable="false" />
          <!-- The river overlay leaves the bridge (y=441..508) and overhanging trees clear. -->
          <svg class="scene-effect" data-effect="river" aria-hidden="true" focusable="false" viewBox="910 0 50 640" style="--effect-x:94.791667%;--effect-y:0%;--effect-w:5.208333%;--effect-h:100%">
            <defs>
              <clipPath id="env-town-river-clear">
                <path d="M914 0H960V178H914ZM934 178H960V290H934ZM914 290H960V441H914ZM934 508H960V602H934ZM928 602H960V640H928Z"/>
              </clipPath>
            </defs>
            <g clip-path="url(#env-town-river-clear)" fill="none" stroke-linecap="round">
              <g class="ambient-motion env-river-current">
                <path d="M919 48q8-3 16 0t16 0M925 125q6-2 12 0t12 0M936 218q7-2 14 0t14 0M919 326q8-3 16 0t16 0M925 404q6-2 12 0t12 0M937 539q7-2 14 0t14 0M932 619q6-2 12 0t12 0" stroke="#e5efd8" stroke-width="1.25"/>
                <path d="M925 53h14M931 130h10M941 223h12M925 331h15M931 409h10M943 544h11M937 624h12" stroke="#b9d8c6" stroke-width=".9"/>
              </g>
              <g class="ambient-motion env-river-current env-river-current-later">
                <path d="M925 15q7-2 14 0t14 0M919 89q8-3 16 0t16 0M925 160q6-2 12 0t12 0M937 265q6-2 12 0t12 0M923 365q7-2 14 0t14 0M936 580q7-2 14 0t14 0" stroke="#e5efd8" stroke-width="1.15"/>
                <path d="M931 20h12M925 94h14M931 165h10M943 270h11M929 370h12M942 585h12" stroke="#bddfce" stroke-width=".9"/>
              </g>
            </g>
          </svg>
          <!-- Only the inner water is animated: stone edges, pedestal and bowl stay crisp. -->
          <svg class="scene-effect" data-effect="fountain" aria-hidden="true" focusable="false" viewBox="430 280 84 56" style="--effect-x:44.791667%;--effect-y:43.75%;--effect-w:8.75%;--effect-h:8.75%">
            <defs>
              <clipPath id="env-town-fountain-water">
                <ellipse cx="472" cy="321" rx="32.5" ry="10.6"/>
              </clipPath>
              <clipPath id="env-town-fountain-pedestal">
                <path d="M430 280H514V336H430Z M460 280H484V324H460Z" clip-rule="evenodd"/>
              </clipPath>
            </defs>
            <g clip-path="url(#env-town-fountain-water)">
              <g clip-path="url(#env-town-fountain-pedestal)" fill="none" stroke="#e5efd5" stroke-width="1.1">
                <ellipse class="ambient-motion env-fountain-ripple" cx="472" cy="321" rx="29" ry="9"/>
                <ellipse class="ambient-motion env-fountain-ripple env-fountain-ripple-later" cx="472" cy="321" rx="29" ry="9"/>
              </g>
            </g>
            <g class="ambient-motion env-fountain-flow" fill="none" stroke="#e3f1da" stroke-width="1.3" stroke-linecap="round">
              <path d="M472 290v-6m-2 4q-3-4-6-1m10 1q3-4 6-1"/>
              <path d="m463 301-1.6 5m19.5-4 1.4 4.5m-23 4-.8 1.7m25.2-1 .8 1.8"/>
            </g>
          </svg>
          <svg id="town-interaction-outline" viewBox="0 0 960 640" aria-hidden="true" focusable="false" hidden>
            <use class="interaction-outline-edge" />
            <use class="interaction-outline-light" />
          </svg>
          <button type="button" class="town-stop" data-place="work" data-town-action="work" style="--x:26.72%;--y:18.52%;--w:19.69%;--h:21.09%"><span class="stop-name">Part-time Jobs</span><span class="stop-detail">Earn a little extra</span></button>
          <button type="button" class="town-stop" data-place="school" data-town-action="school" style="--x:50.21%;--y:21.64%;--w:17.29%;--h:24.53%"><span class="stop-name">School</span><span class="stop-detail">Learn &amp; grow</span></button>
          <span id="town-adventure-slot"></span>
          <button type="button" class="town-stop" data-place="shop" data-town-action="shop" style="--x:21.25%;--y:46.88%;--w:19.17%;--h:19.69%"><span class="stop-name">Shops</span><span class="stop-detail">Stock up on supplies</span></button>
          <button type="button" class="town-stop" data-place="arena" data-town-action="arena" style="--x:78.33%;--y:55.31%;--w:19.38%;--h:22.19%"><span class="stop-name">Arena</span><span class="stop-detail">Meet, visit &amp; battle</span></button>
          <button type="button" id="town-home" class="town-stop" data-town-action="home" style="--x:50.21%;--y:76.33%;--w:16.88%;--h:21.09%"><span class="stop-name">Sweet Home</span><span class="stop-detail">Your cozy corner</span></button>
        </div>
        <div id="world-avatar" class="world-avatar" aria-hidden="true" data-facing="down">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 88" aria-hidden="true">
            <defs>
              <linearGradient id="walker-skin" x1=".15" y1="0" x2=".85" y2="1"><stop stop-color="#ffe1ac"/><stop offset=".6" stop-color="#f4c58e"/><stop offset="1" stop-color="#d99a6b"/></linearGradient>
              <linearGradient id="walker-hair" x1=".15" y1="0" x2=".85" y2="1"><stop stop-color="#9a6845"/><stop offset=".5" stop-color="#785039"/><stop offset="1" stop-color="#513c2d"/></linearGradient>
              <linearGradient id="walker-cap" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="#afbc83"/><stop offset=".45" stop-color="#8ba06f"/><stop offset="1" stop-color="#5f7958"/></linearGradient>
              <linearGradient id="walker-cap-brim" x1="0" y1="0" x2=".5" y2="1"><stop stop-color="#91a776"/><stop offset="1" stop-color="#4e6950"/></linearGradient>
              <linearGradient id="walker-jacket" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e8ac72"/><stop offset=".48" stop-color="#d18455"/><stop offset="1" stop-color="#a65c42"/></linearGradient>
              <linearGradient id="walker-sleeve" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#db9c63"/><stop offset="1" stop-color="#b86c48"/></linearGradient>
              <linearGradient id="walker-scarf" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fff2ce"/><stop offset="1" stop-color="#d9bc8a"/></linearGradient>
              <linearGradient id="walker-trousers" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6f8172"/><stop offset="1" stop-color="#435b54"/></linearGradient>
              <linearGradient id="walker-boots" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#94704e"/><stop offset=".4" stop-color="#79583e"/><stop offset="1" stop-color="#4b3c30"/></linearGradient>
              <linearGradient id="walker-pack" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9bc81"/><stop offset=".45" stop-color="#bc965f"/><stop offset="1" stop-color="#937044"/></linearGradient>
            </defs>
            <ellipse class="walker-shadow" cx="32" cy="84" rx="19" ry="3.2" fill="#3e4331" opacity=".24"/>
            <g class="walker-direction" stroke-linecap="round" stroke-linejoin="round">
              <g class="walker-view walker-front">
                <g class="walker-leg walker-leg--far">
                  <path d="M22 61h10l-1.5 17-9-.3Z" fill="url(#walker-trousers)" stroke="#46594e" stroke-width="1"/>
                  <path d="m24 65-.4 9" fill="none" stroke="#9baa89" stroke-width="1.1"/>
                  <path d="M21.7 75.2q4.2 2 8.7.2l.3 5.5q-.2 2.1-3 2.2h-8.1q-2.1-.2-1.4-2.6l1.3-2.7Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="M19 81.5q5 1.2 10.7 0" fill="none" stroke="#b38c5d" stroke-width="1"/>
                  <path d="m22.7 77.5 4 .3" stroke="#d2ab76" stroke-width="1.1"/>
                </g>
                <g class="walker-leg walker-leg--near">
                  <path d="M33 61h10l-.5 16.7-9 .4Z" fill="url(#walker-trousers)" stroke="#46594e" stroke-width="1"/>
                  <path d="m36.2 65 .1 9" fill="none" stroke="#9baa89" stroke-width="1.1"/>
                  <path d="M33.7 75.5q4.2 1.8 8.7-.3l2.3 3.8q1.6 3.3-1.1 3.9h-8.1q-2.5-.2-2.2-2.3Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="M34.2 81.5q4.8 1.2 9.6-.1" fill="none" stroke="#b38c5d" stroke-width="1"/>
                  <path d="m36.4 77.8 4-.3" stroke="#d2ab76" stroke-width="1.1"/>
                </g>
                <g class="walker-upper">
                  <path d="M15 47q0-5 5-5h23q5 0 5 5v15q0 3-4 3H19q-4 0-4-3Z" fill="url(#walker-pack)" stroke="#84623f" stroke-width="1"/>
                  <g class="walker-arm walker-arm--far">
                    <path d="M19.8 44.8q-5.2 1-6 5.1l-2.2 10q3.7 2.8 7.7 1.7l3.4-12Z" fill="url(#walker-sleeve)" stroke="#9d6042" stroke-width="1.1"/>
                    <path d="m13.2 58.5 6.3 1.6-.8 3-6.3-1.5Z" fill="#ecd2a2" stroke="#b38759" stroke-width=".7"/>
                    <path d="m12.4 61.1-.8 3.5q-.5 3.7 2.4 4.2 3.5.5 4.1-2.5l.6-3.7Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                    <path d="m15.6 64.2-.5 1.9" stroke="#d59970" stroke-width=".8"/>
                  </g>
                  <path d="M22 43q10-3 20 0l3.2 21.3q-12.7 5.5-26.4 0Z" fill="url(#walker-jacket)" stroke="#985d40" stroke-width="1.2"/>
                  <path d="M24.5 44.8q2.2 7.5 1.8 18.6" fill="none" stroke="#efbd84" stroke-width="1.2" opacity=".8"/>
                  <path d="M32 48v18" fill="none" stroke="#ad6a46" stroke-width="1"/>
                  <path d="M20.4 62.8q11.8 4.2 23.3 0" fill="none" stroke="#efb884" stroke-width="1"/>
                  <path d="m22.5 55.4 5.2.7-.5 4.1-5.1-.7Zm14 .7 5.1-.7.5 4.1-5.1.7Z" fill="#bb714b" stroke="#ab6645" stroke-width=".7"/>
                  <path d="m22.5 55.4 5.2.7m8.8 0 5.1-.7" stroke="#efb782" stroke-width=".9"/>
                  <circle cx="32" cy="55" r="1" fill="#f4d49a"/><circle cx="32" cy="61" r="1" fill="#f4d49a"/>
                  <path d="M23 43.3q8.9 4.5 18 0l-3.8 7.2-5.4-2.8-4.9 2.8Z" fill="url(#walker-scarf)" stroke="#c4a574" stroke-width=".9"/>
                  <path d="m32 46.7 3 4.7-2 6-3-5.9Z" fill="#f5dfb0" stroke="#c6a574" stroke-width=".7"/>
                  <path d="M21.3 43.4 18.7 55m24-11.6 2 11.3" fill="none" stroke="#916c45" stroke-width="2.7"/>
                  <path d="M21.1 44.3 19 53m23.7-8.7 1.5 8.5" fill="none" stroke="#e3bf83" stroke-width="1"/>
                  <g class="walker-arm walker-arm--near">
                    <path d="M43.2 44.8q5.4 1 6.3 5.1l2.1 10q-3.7 2.8-7.7 1.7l-3.1-12Z" fill="url(#walker-sleeve)" stroke="#9d6042" stroke-width="1.1"/>
                    <path d="m44.1 60.1 6.3-1.6.9 3.1-6.4 1.5Z" fill="#ecd2a2" stroke="#b38759" stroke-width=".7"/>
                    <path d="m45 63.1.5 3.7q.5 3 4 2.5 3-.5 2.5-4.2l-.8-3.5Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                    <path d="m48 64.2.5 1.9" stroke="#d59970" stroke-width=".8"/>
                  </g>
                  <g class="walker-head">
                    <path d="M15.5 19q-4.1 9.1.8 17l-2 1.3 5.8 3.1 1.7-5.9 22.6.6 2.7 4.6 3.4-3.9-1.8-1.1q4.7-10.5-.3-17.9Z" fill="url(#walker-hair)" stroke="#654532" stroke-width="1"/>
                    <ellipse cx="16.6" cy="29.6" rx="3.9" ry="5.2" fill="url(#walker-skin)" stroke="#bb8058" stroke-width=".9"/>
                    <ellipse cx="47.7" cy="29.6" rx="3.9" ry="5.2" fill="url(#walker-skin)" stroke="#bb8058" stroke-width=".9"/>
                    <path d="M17.2 19.7q14.7-10 29.6 0l.2 13.2q-.8 10.2-14.8 11.6Q18.7 43.4 17 33Z" fill="url(#walker-skin)" stroke="#b57d56" stroke-width="1"/>
                    <path d="M19.6 21.7q1.7-5.3 9.4-5.6" fill="none" stroke="#ffe8bd" stroke-width="1.7" opacity=".8"/>
                    <ellipse cx="21.5" cy="34.8" rx="3.6" ry="2.1" fill="#dc9176" opacity=".48"/><ellipse cx="42.8" cy="34.8" rx="3.6" ry="2.1" fill="#dc9176" opacity=".48"/>
                    <path d="m30.7 34.1 1.6.7 1.3-.6" fill="none" stroke="#ca8c61" stroke-width="1"/>
                    <g class="walker-eyes" fill="#423d32">
                      <ellipse cx="25" cy="29.8" rx="2" ry="2.7"/><ellipse cx="39.5" cy="29.8" rx="2" ry="2.7"/>
                      <circle cx="24.5" cy="28.9" r=".6" fill="#fff6d9"/><circle cx="39" cy="28.9" r=".6" fill="#fff6d9"/>
                    </g>
                    <path d="M22.6 25q2.1-.8 4 .1m10.7 0q2-.9 4-.1" fill="none" stroke="#8a5d3c" stroke-width="1"/>
                    <path d="M28.6 37q3.7 3 7.2-.2" fill="none" stroke="#8c5741" stroke-width="1.2"/>
                    <path d="M16 21.7q1-11 15-11.7 14.5-.5 17.6 11.3l-6.3-.6-1.6-4q-2.7 6.9-8.6 8.1l.7-6.2q-5.5 6.1-13.6 7.2l.3-5Z" fill="url(#walker-hair)" stroke="#654532" stroke-width="1"/>
                    <path d="M22.5 19q4.4-1.6 7.1-5m7.2 1.8-1.6 4.6" fill="none" stroke="#b47e4e" stroke-width="1.1" opacity=".7"/>
                    <path d="M14.2 17.4Q14.9 4.9 30 3.6 46.9 2.7 49 17.3q-17.3 6-34.8.1Z" fill="url(#walker-cap)" stroke="#536b4b" stroke-width="1.1"/>
                    <path d="M18.9 11.7q4-5.7 12.8-5.4m3.1.2q5.5 3.2 5.9 9.8" fill="none" stroke="#c8ce98" stroke-width="1.1" opacity=".8"/>
                    <path d="M11.6 17.4q20.4-5.1 40.5.1 3.2 1.1.2 3.2-18.9 5.4-40.7-.2-3-1.3 0-3.1Z" fill="url(#walker-cap-brim)" stroke="#50654a" stroke-width="1"/>
                    <path d="M16 17.5q14.9-2.8 30.7-.3" fill="none" stroke="#c1ca93" stroke-width="1.1"/>
                    <path d="M43.6 10.1q-5.8 0-4 5.1 4.4.1 4-5.1Z" fill="#d9ce93"/><path d="m40 14.4 2.1-2.6" stroke="#809268" stroke-width=".65"/>
                  </g>
                </g>
              </g>
              <g class="walker-view walker-back">
                <g class="walker-leg walker-leg--far">
                  <path d="M22 61h10l-1.5 17-9-.3Z" fill="url(#walker-trousers)" stroke="#46594e" stroke-width="1"/>
                  <path d="m25 66-.2 9" fill="none" stroke="#8b9b80" stroke-width="1"/>
                  <path d="M21.7 75.2q4.2 2 8.7.2l.5 6q-.3 1.6-2.5 1.7h-7q-2.3-.3-1.8-2.7Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="m21 81.2 8.3.1m-4.1-4.4-.2 3" stroke="#b38c5d" stroke-width="1"/>
                </g>
                <g class="walker-leg walker-leg--near">
                  <path d="M33 61h10l-.5 16.7-9 .4Z" fill="url(#walker-trousers)" stroke="#46594e" stroke-width="1"/>
                  <path d="m37 66 .2 9" fill="none" stroke="#8b9b80" stroke-width="1"/>
                  <path d="M33.7 75.5q4.2 1.8 8.7-.3l1.9 5.5q.5 2.1-1.9 2.4h-7q-2.2-.1-2.4-1.7Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="m34.9 81.3 8.1-.1m-4.3-4.3.2 3" stroke="#b38c5d" stroke-width="1"/>
                </g>
                <g class="walker-upper">
                  <g class="walker-arm walker-arm--far">
                    <path d="M19.8 44.8q-5.2 1-6 5.1l-2.2 10q3.7 2.8 7.7 1.7l3.4-12Z" fill="url(#walker-sleeve)" stroke="#9d6042" stroke-width="1.1"/>
                    <path d="m13.2 58.5 6.3 1.6-.8 3-6.3-1.5Z" fill="#ecd2a2" stroke="#b38759" stroke-width=".7"/>
                    <path d="m12.4 61.1-.8 3.5q-.5 3.7 2.4 4.2 3.5.5 4.1-2.5l.6-3.7Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                  </g>
                  <path d="M22 43q10-3 20 0l3.2 21.3q-12.7 5.5-26.4 0Z" fill="url(#walker-jacket)" stroke="#985d40" stroke-width="1.2"/>
                  <path d="M20.4 62.8q11.8 4.2 23.3 0" fill="none" stroke="#efb884" stroke-width="1"/>
                  <path d="M23.8 42.4q8 3.9 16.2 0l.3 5.2q-8.3 3-16.7 0Z" fill="url(#walker-scarf)" stroke="#c4a574" stroke-width=".9"/>
                  <path d="M22 44q-4 5-2.7 16m22.5-16q4 5 2.5 16" fill="none" stroke="#8d6a43" stroke-width="3.1"/>
                  <path d="M22 45q-2.8 5-1.7 14m21.5-14q2.8 5 1.5 14" fill="none" stroke="#e0bc7f" stroke-width="1.1"/>
                  <path d="M21.8 49q0-4.6 10.1-4.6T42 49l1.2 14.4q0 4.4-11.3 4.5t-11.3-4.5Z" fill="url(#walker-pack)" stroke="#89663f" stroke-width="1.2"/>
                  <path d="M27.2 45.5v-2.1q4.7-2.9 9.3 0v2.1" fill="none" stroke="#8c6a43" stroke-width="1.8"/>
                  <path d="M21.8 49q9.9-4.3 20.2 0l-.8 5.8q-9.2 4.4-18.6 0Z" fill="#d6b681" stroke="#9e794c" stroke-width=".9"/>
                  <path d="M24 49q7.9-2.8 16-.1" fill="none" stroke="#efcf93" stroke-width="1.1"/>
                  <path d="M26 58.8q6-1.7 12 0v5q-6 2.3-12 0Z" fill="#caa770" stroke="#967246" stroke-width=".8"/>
                  <path d="M27.5 60h9" stroke="#edca90" stroke-width="1"/>
                  <path d="M30.2 51.9h3.7v7h-3.7Z" fill="#90683e"/><rect x="30.5" y="54.1" width="3.1" height="2.4" rx=".5" fill="#ebcf8c"/>
                  <g class="walker-arm walker-arm--near">
                    <path d="M43.2 44.8q5.4 1 6.3 5.1l2.1 10q-3.7 2.8-7.7 1.7l-3.1-12Z" fill="url(#walker-sleeve)" stroke="#9d6042" stroke-width="1.1"/>
                    <path d="m44.1 60.1 6.3-1.6.9 3.1-6.4 1.5Z" fill="#ecd2a2" stroke="#b38759" stroke-width=".7"/>
                    <path d="m45 63.1.5 3.7q.5 3 4 2.5 3-.5 2.5-4.2l-.8-3.5Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                  </g>
                  <g class="walker-head">
                    <ellipse cx="16.6" cy="29.6" rx="3.9" ry="5.2" fill="url(#walker-skin)" stroke="#bb8058" stroke-width=".9"/>
                    <ellipse cx="47.7" cy="29.6" rx="3.9" ry="5.2" fill="url(#walker-skin)" stroke="#bb8058" stroke-width=".9"/>
                    <path d="M16.1 16.9q16.7-12 32 1l.6 14.2 2.4 4.2-4.5 1.1.3 4.7-5.3-2q-3.6 4.3-9.7 4.8-5.2-.2-9.7-4.2l-5.6 1.3.6-4-3.8-2.1 2.3-4Z" fill="url(#walker-hair)" stroke="#654532" stroke-width="1"/>
                    <path d="M21.9 24q-2 8.6 2.9 13m6.4-11q-2.5 10.6 2.5 14m7.1-15q3.4 7.6.7 12" fill="none" stroke="#ac794d" stroke-width="1.4" opacity=".55"/>
                    <path d="M14.2 19.4Q14.2 4.9 30 3.6 47.6 2.7 49 19.3q-16.9 9.7-34.8.1Z" fill="url(#walker-cap)" stroke="#536b4b" stroke-width="1.1"/>
                    <path d="M18.9 11.7q4-5.7 12.8-5.4m2.8.2q4.6 6.3 3.7 14.5" fill="none" stroke="#c8ce98" stroke-width="1.1" opacity=".8"/>
                    <path d="M15.1 19q16.5 8.1 33 .1l-.6 4q-15.7 7.6-31.7-.2Z" fill="url(#walker-cap-brim)" stroke="#50654a" stroke-width=".9"/>
                    <path d="M27 23.2q4.8 1 9.7 0v3.1q-4.8 1.1-9.7-.1Z" fill="#c6bd87" stroke="#687956" stroke-width=".7"/>
                    <circle cx="31.9" cy="24.7" r=".75" fill="#6f805a"/>
                  </g>
                </g>
              </g>
              <g class="walker-view walker-side">
                <g class="walker-leg walker-leg--far">
                  <path d="M25.3 61.2h9.2l1.3 16-8.6.3Z" fill="#4c635a" stroke="#41554c" stroke-width="1"/>
                  <path d="M27 75.7q4.4 1.5 8.3-.4l1.6 2.7 5.9 1q2.9 1.2 1.1 3.5H26.4q-1.4-.6-.6-2.4Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="M27 81.2h14.9" stroke="#a7845b" stroke-width="1"/>
                </g>
                <g class="walker-leg walker-leg--near">
                  <path d="M30.2 61h10l-.7 16.3-9 .7Z" fill="url(#walker-trousers)" stroke="#46594e" stroke-width="1"/>
                  <path d="m33.5 65 .3 9" stroke="#9baa89" stroke-width="1"/>
                  <path d="M30.7 75.6q4.2 1.8 8.6-.2l2 3 5.2 1q2.5 1 1.8 3.1-.3 1.1-2.6 1.1H30.4q-1.9-.5-1-3.1Z" fill="url(#walker-boots)" stroke="#4d3d2f" stroke-width="1.1"/>
                  <path d="M30.6 82h15.7m-7.4-3.4 2.8 1" fill="none" stroke="#bc9767" stroke-width="1"/>
                </g>
                <g class="walker-upper">
                  <g class="walker-arm walker-arm--far">
                    <path d="M36.5 44.5q5.3-.2 6.8 6.5l2.9 9.1-6.9 2-5.2-14Z" fill="#b87950" stroke="#9d6042" stroke-width="1"/>
                    <path d="m39.7 60 6.2-1.5 1 3.2-6.2 1.4Z" fill="#ddc18e"/>
                    <path d="m40.7 62.3 1.3 3.7q1.2 3.3 4.2 2 2.5-1.2 1.1-4.3l-.8-2.2Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                  </g>
                  <path d="M25.2 43.3q8.8-2.3 15.3 1.2 3.3 9.9 1.8 20.4-9.6 3.9-19.1-1Z" fill="url(#walker-jacket)" stroke="#985d40" stroke-width="1.2"/>
                  <path d="M38.3 49q2.2 8 1.3 13.7" fill="none" stroke="#efb884" stroke-width="1.2"/>
                  <path d="M24.7 63.1q8 3 16.4.4" fill="none" stroke="#efb884" stroke-width="1"/>
                  <path d="M28.1 42.8q7.6 2.6 13.2.5l-1.8 7.2-5.8-2.8-5.8 1.5Z" fill="url(#walker-scarf)" stroke="#c4a574" stroke-width=".8"/>
                  <path d="m38 47.3 3.1 3.5-1.1 6.5-3.3-5.6Z" fill="#f5dfb0" stroke="#c6a574" stroke-width=".7"/>
                  <path d="M28 43.7q-4.8 2.1-3.3 14.9" fill="none" stroke="#8c6842" stroke-width="3"/>
                  <path d="M28 44.7q-3.5 2.7-2.2 12.7" fill="none" stroke="#e4c085" stroke-width="1.1"/>
                  <path d="M17.2 46q2.4-2 7.8 0l.6 18q-5.5 3-10.5-.8l-.3-12.3q.1-3.4 2.4-4.9Z" fill="url(#walker-pack)" stroke="#89663f" stroke-width="1.1"/>
                  <path d="M16.9 46.7q3.8-2 8.1.3l-.3 6.2q-4.2 1.5-8.2-.9Z" fill="#d8b982" stroke="#a17b4d" stroke-width=".8"/>
                  <path d="M17.2 57.1q2.9-1.1 5.8 0l.1 5q-3.1 1.1-5.9-.6Z" fill="#c6a16a" stroke="#9b7648" stroke-width=".7"/>
                  <path d="m20 51 .1 4.1" stroke="#8d6740" stroke-width="2"/>
                  <g class="walker-arm walker-arm--near">
                    <path d="M31 45.6q5.6-1.1 7 3.8l.5 11.7q-3.8 2.1-7.2.3l-3.1-10.9q-1-3.7 2.8-4.9Z" fill="url(#walker-sleeve)" stroke="#9d6042" stroke-width="1.1"/>
                    <path d="m30.7 59.1 7.9.1-.1 3.6-6.7.1Z" fill="#ecd2a2" stroke="#b38759" stroke-width=".7"/>
                    <path d="M31.9 62.7v4q.3 3.6 3.7 3.4 3.1-.3 2.8-4l-.3-3.5Z" fill="url(#walker-skin)" stroke="#ad7955" stroke-width="1"/>
                    <path d="m34.8 65.7.1 1.8" stroke="#d59970" stroke-width=".8"/>
                    <path d="m30.6 49 1.4 6" stroke="#edb47b" stroke-width="1.2"/>
                  </g>
                  <g class="walker-head">
                    <path d="M17.1 15.9q8.4-9.5 21.1-3.9L46 29.9l-3.1 8.8-7.9 3.6-6.8-1.4-5.9 2-1.8-4-4.5-1.6 2-3.9-3.2-5.6Z" fill="url(#walker-hair)" stroke="#654532" stroke-width="1"/>
                    <path d="M29.3 18.4q9-4.5 17.7 3.3l.3 8 4.6 3.6q1.2 2.2-3 2.6l-1.5 4.2q-2.5 4.7-11.5 4.4-6.4-1.3-8.2-6.9Z" fill="url(#walker-skin)" stroke="#b57d56" stroke-width="1"/>
                    <ellipse cx="41.2" cy="35.4" rx="3.8" ry="2" fill="#dc9176" opacity=".45"/>
                    <g class="walker-eyes"><ellipse cx="43.9" cy="29.8" rx="1.7" ry="2.6" fill="#423d32"/><circle cx="43.4" cy="28.9" r=".55" fill="#fff6d9"/></g>
                    <path d="M41.7 25.5q2.1-.9 3.6.4" fill="none" stroke="#8a5d3c" stroke-width="1"/>
                    <path d="M43 38.9q2.1 1.1 4.2-.8" fill="none" stroke="#8c5741" stroke-width="1.1"/>
                    <path d="M18.5 17q13-10.5 27.3 1.6l1.5 5.5q-4.5-.7-8.9-5.6l-3.1 11-4-2.3-2.3 11.7-7.4-2.3q-5.3-6.5-3.1-19.6Z" fill="url(#walker-hair)" stroke="#654532" stroke-width="1"/>
                    <path d="M22 24q-1 7.4 3 10m6.1-15.9-2 5.5" fill="none" stroke="#b37c4d" stroke-width="1.2" opacity=".7"/>
                    <ellipse cx="31" cy="31.1" rx="4.2" ry="5.2" fill="url(#walker-skin)" stroke="#b57d56" stroke-width=".9"/>
                    <path d="M29.7 30.1q2.4-1.7 2.6 1.4l-1.4 1.2" fill="none" stroke="#c18a61" stroke-width=".9"/>
                    <path d="M15 17.7Q14.7 4.2 29.6 3.6 44.7 2.9 47.2 18q-15.1 6.4-32.2-.3Z" fill="url(#walker-cap)" stroke="#536b4b" stroke-width="1.1"/>
                    <path d="M19.4 11.4q3.8-5.3 11.6-5.1m3 .4q4.8 4.3 5.7 10.2" fill="none" stroke="#c8ce98" stroke-width="1.1" opacity=".8"/>
                    <path d="M16.1 18q17.9 3.2 29.1-2.1l10.3 3.6q2.4 1.8-.7 3.6-10.9 4.3-24-1.7-7.3 2.4-14.6-.3Z" fill="url(#walker-cap-brim)" stroke="#50654a" stroke-width="1"/>
                    <path d="m42.1 17.7 10.8 2.8" fill="none" stroke="#c1ca93" stroke-width="1"/>
                    <path d="M34.9 11.3q-5.8 0-4 5.1 4.4.1 4-5.1Z" fill="#d9ce93"/><path d="m31.3 15.6 2.1-2.6" stroke="#809268" stroke-width=".65"/>
                  </g>
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
      <p id="home-controls-tip"><span><kbd>W/A/S/D</kbd> move</span><span><kbd>Space bar</kbd> interact</span></p>
      <p id="home-feedback" role="status" aria-live="polite" hidden></p>
      <div class="scene-caption"><p id="world-message" role="status">Welcome home. Your pet is happy to see you.</p><button type="button" id="world-interact" class="world-button" disabled>Move closer to interact</button></div>
      <div class="world-controls">
        <p class="movement-help" id="world-movement-help"><kbd>W A S D</kbd> or <kbd>↑ ← ↓ →</kbd> to walk · <kbd>Space</kbd> to interact<br /><span>Click the floor to walk. Select any object or building to interact.</span></p>
        <div class="movement-pad" role="group" aria-label="Move your character">
          <button type="button" data-world-direction="up" aria-label="Walk up">↑</button><button type="button" data-world-direction="left" aria-label="Walk left">←</button><button type="button" data-world-direction="down" aria-label="Walk down">↓</button><button type="button" data-world-direction="right" aria-label="Walk right">→</button>
        </div>
      </div>
    </div>
    <aside class="world-companion" aria-label="Your companion and care">
      <p class="companion-heading world-eyebrow">YOUR LITTLE COMPANION</p>
      <div id="world-pet-summary"></div>
      <p id="home-interaction-label">Choose an interaction</p>
      <div class="home-care" aria-label="Care for your pet at home"><button type="button" id="home-feed" class="world-button" disabled><svg class="icon" aria-hidden="true"><use href="#i-food" /></svg><span>Feed <small id="home-feed-count">0 left</small></span></button><button type="button" id="home-clean" class="world-button" disabled><svg class="icon" aria-hidden="true"><use href="#i-soap" /></svg><span>Clean <small id="home-clean-count">0 left</small></span></button></div>
      <p id="home-care-hint" class="world-care-hint help"></p><p id="home-care-error" class="error" role="alert"></p>
      <div id="world-play" class="home-play"></div>
      <p id="town-care-hint" class="help" hidden>Head home to feed, clean, and spend time with your pet.</p>
      <div class="companion-footer"><button type="button" class="world-button" data-place="backpack">Backpack</button><button type="button" class="world-button" data-place="appearance">Appearance</button></div>
    </aside>
  </div>
  <nav class="world-nav" aria-label="Explore VirtuePets"><button type="button" id="world-home" aria-current="page">Sweet Home</button><button type="button" id="world-town">Town map</button><button type="button" data-place="backpack">Backpack</button><button type="button" id="world-journal" data-place="journal">Journal</button></nav>`;
worldDashboard.append(worldShell);

const worldStage = worldById('world-stage');
const worldAvatar = worldById('world-avatar');
// Keep the activity indicator fixed to the viewport, outside the moving map.
worldShell.querySelector('.world-main').append(worldById('town-activity'));
const homeInteractionOutline = worldById('home-interaction-outline');
const homeOutlineStrokes = homeInteractionOutline.querySelectorAll('use');
const townInteractionOutline = worldById('town-interaction-outline');
const townOutlineStrokes = townInteractionOutline.querySelectorAll('use');
const homePet = worldById('pet-touch');
homePet.classList.add('home-pet');
worldById('home-scene').append(homePet);
worldById('world-pet-summary').append(original.hero, original.stats, worldById('busy'));
worldById('world-play').append(original.play);

const worldDialog = document.createElement('dialog');
worldDialog.id = 'world-dialog';
worldDialog.className = 'place-dialog';
worldDialog.setAttribute('aria-labelledby', 'world-dialog-title');
worldDialog.innerHTML = `<header class="place-heading"><div><p class="world-eyebrow" id="world-place-eyebrow">AROUND TOWN</p><h2 id="world-dialog-title"></h2></div><button type="button" class="world-button" id="world-dialog-close" aria-label="Close window">Close <span aria-hidden="true">×</span></button></header><p id="world-place-intro" class="place-intro"></p><div class="place-body"></div>`;
document.body.append(worldDialog);
const worldPanels = {};
for (const name of ['school', 'work', 'shop', 'arena', 'journal', 'appearance', 'pet', 'menu', 'visit']) {
  const panel = document.createElement('section');
  panel.id = `world-panel-${name}`;
  panel.className = 'world-panel';
  panel.hidden = true;
  worldDialog.querySelector('.place-body').append(panel);
  worldPanels[name] = panel;
}
worldPanels.school.append(original.school, original.study);
worldPanels.work.append(original.work);
worldPanels.shop.append(original.supplies, original.adventure);
worldPanels.arena.append(original.arena);
worldPanels.visit.append(worldById('visit'));
worldPanels.appearance.append(worldById('appearance-settings'));
worldPanels.pet.classList.add('world-companion');
worldPanels.menu.innerHTML = '<p class="help">Take your time. Your pet and progress are saved.</p><p><a href="/readme/" target="_blank" rel="noopener">How to play</a></p><button type="button" class="world-button" id="world-pet-details" data-place="pet">Pet details</button> <button type="button" class="world-button" data-place="backpack">Backpack</button> <button type="button" class="world-button" data-place="journal">Town journal</button> <button type="button" class="world-button" data-place="appearance">Appearance</button>';
for (const selector of ['#world-pet-summary', '#home-interaction-label', '.home-care', '#home-care-hint', '#home-care-error', '#world-play', '#town-care-hint', '.companion-footer']) {
  worldPanels.pet.append(worldShell.querySelector(selector));
}
const signoutAnchor = document.createComment('sign out position');
worldById('signout').before(signoutAnchor);
for (const node of [worldById('visitors-heading'), worldById('visitors'), worldById('visitors-empty'), worldById('theft-notifications'), worldById('fight-log').previousElementSibling, worldById('fight-log'), worldById('feed-heading'), worldById('feed')]) worldPanels.journal.append(node);
const journalEmpty = document.createElement('p');
journalEmpty.className = 'help';
journalEmpty.id = 'world-reports-empty';
journalEmpty.textContent = 'No theft reports. A peaceful day in the neighbourhood.';
worldById('theft-notifications').before(journalEmpty);

const adventureEntrance = worldById('adventure-open');
adventureEntrance.className = 'town-stop';
adventureEntrance.dataset.townAction = 'adventure';
adventureEntrance.style.cssText = '--x:79.90%;--y:21.95%;--w:13.13%;--h:18.28%';
adventureEntrance.setAttribute('aria-describedby', 'adventure-hint');
adventureEntrance.innerHTML = '<span class="stop-name">Adventure</span><span class="stop-detail">Into the woodland</span>';
worldById('town-adventure-slot').replaceWith(adventureEntrance);
worldById('adventure-hint').classList.add('world-adventure-hint');
worldById('town-scene').append(worldById('adventure-hint'));
worldById('adventure-heading').textContent = 'Abilities & equipment';
original.adventure.querySelector('.help').textContent = 'Your woodland discoveries travel with you. Equipped coins work in Adventure, Arena, and revenge.';
original.adventure.querySelector('.treasure-inventory').open = true;
original.adventure.querySelector('.treasure-inventory > .help:nth-of-type(2)').textContent = 'Solo battles use your coin. In PvP and team battles, the pet with the highest total attributes supplies the coin.';

const worldPlaces = {
  shop: ['Village shops', 'A few essentials for a very good day. Buy food, soap, and hourglasses, or collect your free daily supplies.'],
  backpack: ['Your backpack', 'Prepare battle skills at home, check your supplies, and choose a lucky coin.'],
  school: ['A little learning', 'Every lesson brings your pet a little further. Choose a course and watch them grow.'],
  work: ['Part-time jobs', 'Find a shift that suits your pet. Build skills, earn money, and work your way up.'],
  arena: ['The town arena', 'Meet your neighbours, visit their pets, or challenge someone to a friendly rivalry.'],
  journal: ['Your town journal', 'Recent visitors, battles, town news, and any theft reports that need your attention.'],
  appearance: ["Your pet's little nook", 'Make your companion feel like yours. Choose a shape and colour, then save your appearance.'],
  pet: ['Your companion', 'A little affection goes a long way. Play, care, or see how your pet is doing.'],
  menu: ['Make yourself at home', ''],
  visit: ['Visiting a neighbour', ''],
};
let worldScene = 'home';
let worldFrame = 0;
let worldLastFrame = 0;
let worldKeys = new Set();
let worldPath = [];
const worldMoveInterval = 50;
const worldWalkSpeed = 190;
let worldPosition = { x: 480, y: 475 };
// Render only confirmed travel, with the camera on the very same frame.
let worldVisualPosition = { ...worldPosition };
let worldVisualFrame = 0;
let worldTween = null;
let worldView = { width: 960, height: 640, viewportWidth: 960, viewportHeight: 640 };
let worldCameraTransform = '';
let worldAvatarTransform = '';
let worldNearest = null;
let worldHighlighted = null;
let worldFeedbackTimer = 0;
let worldCarePending = null;
let worldWasVisible = false;
let worldWindowActive = true;
let worldPlayerId = null;
let worldHome = null;
let worldSaved = null;
let worldIntent = { ...worldPosition };
let worldIntentFacing = 'down';
let worldIntentMoving = false;
let worldQueued = null;
let worldSending = false;
let worldSendTimer = 0;
let worldLastSent = 0;
let worldGeneration = 0;
let worldApplying = false;
let worldConnected = false;
let worldPlaced = false;
let worldSpawnRevision = null;
let worldVisitedPet = null;
const worldPlayers = new Map();
let worldOnline = new Set();
let worldPresenceChanges = 0;
const worldPeers = new Map();
const worldNetworked = () => Boolean(worldPlayerId && typeof fetch === 'function');
const worldVisiting = () => worldScene === 'home' && worldHome && worldHome !== worldPlayerId;
const visitPet = document.createElement('button');
visitPet.type = 'button'; visitPet.id = 'world-visit-pet'; visitPet.className = 'pet-touch home-pet'; visitPet.hidden = true;
worldById('home-scene').append(visitPet);
visitPet.addEventListener('click', () => worldOpenPlace('visit'));
new MutationObserver(() => { visitPet.dataset.reaction = worldById('visit-touch').dataset.reaction; })
  .observe(worldById('visit-touch'), { attributes: true, attributeFilter: ['data-reaction'] });
const visitBar = document.createElement('div');
visitBar.id = 'world-visit-bar'; visitBar.hidden = true;
visitBar.innerHTML = '<span></span><button type="button" class="world-button">Leave home</button>';
worldShell.querySelector('.world-main').append(visitBar);
visitBar.querySelector('button').addEventListener('click', () => worldById('visit-close').click());

function worldRenderVisit() {
  const visiting = worldVisiting();
  const hotspot = worldShell.querySelector('[data-home-action="pet"]');
  hotspot.setAttribute('aria-label', visiting ? `Visit ${worldHome}'s pet` : 'Spend time with your pet: care and details');
  hotspot.querySelector('.hotspot-label').textContent = visiting ? `${worldHome}'s pet` : 'Your companion';
  homePet.hidden = Boolean(visiting);
  visitPet.hidden = !visiting;
  visitBar.hidden = !visiting;
  if (!visiting) return;
  visitBar.querySelector('span').textContent = `${worldHome}'s home`;
  visitPet.setAttribute('aria-label', `Visit ${worldHome}'s pet`);
  worldPlaces.visit[0] = `${worldHome}'s pet`;
  if (worldVisitedPet?.id === worldHome) {
    const avatar = worldById('visit-avatar').cloneNode(true);
    avatar.removeAttribute('id');
    visitPet.replaceChildren(avatar);
  }
}

function worldRenderPeers() {
  const visible = new Set();
  for (const player of worldPlayers.values()) {
    if (player.id === worldPlayerId || !worldOnline.has(player.id) || player.scene !== worldScene ||
      (worldScene === 'home' && player.home !== worldHome)) continue;
    visible.add(player.id);
    let avatar = worldPeers.get(player.id);
    if (!avatar) {
      avatar = worldAvatar.cloneNode(true);
      avatar.removeAttribute('id');
      // Reuse the original SVG's definitions without duplicate document IDs.
      avatar.querySelector('defs')?.remove();
      avatar.classList.add('world-peer');
      avatar.dataset.player = player.id;
      avatar.removeAttribute('aria-hidden');
      const label = document.createElement('span');
      label.className = 'world-player-name'; label.textContent = player.id;
      avatar.append(label);
      worldStage.append(avatar); worldPeers.set(player.id, avatar);
    }
    avatar.style.transform = `translate3d(${player.x * worldView.width / 960}px, ${player.y * worldView.height / 640}px, 0) translate(-50%, -100%)`;
    avatar.dataset.facing = player.facing;
    avatar.dataset.walking = String(player.moving);
    avatar.dataset.paused = String(document.hidden);
  }
  for (const [id, avatar] of worldPeers) if (!visible.has(id)) { avatar.remove(); worldPeers.delete(id); }
}

function worldSnapVisual() {
  cancelAnimationFrame(worldVisualFrame);
  worldVisualFrame = 0;
  worldTween = null;
  worldVisualPosition = { ...worldPosition };
}
function worldAnimateVisual(now) {
  worldVisualFrame = 0;
  if (!worldTween) return;
  const { to, lastFrame } = worldTween;
  const dx = to.x - worldVisualPosition.x, dy = to.y - worldVisualPosition.y;
  const distance = Math.hypot(dx, dy);
  const travel = Math.min(distance, Math.max(0, now - lastFrame) / 1000 * worldWalkSpeed);
  worldTween.lastFrame = now;
  if (travel === distance) {
    worldVisualPosition = { ...to };
    worldTween = null;
    worldAvatar.dataset.walking = String(Boolean(worldSaved?.moving));
  } else worldVisualPosition = { x: worldVisualPosition.x + dx / distance * travel, y: worldVisualPosition.y + dy / distance * travel };
  worldDrawPosition();
  if (worldTween) worldVisualFrame = requestAnimationFrame(worldAnimateVisual);
}
function worldPresent(player) {
  const changed = worldVisualPosition.x !== player.x || worldVisualPosition.y !== player.y;
  if (!changed || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    worldSnapVisual();
  } else if (changed && (worldTween?.to.x !== player.x || worldTween?.to.y !== player.y)) {
    // Only the animation frame advances the sprite. Preserve its clock when
    // retargeting so delayed replies cannot cause a sprint or lose travel time.
    const to = { x: player.x, y: player.y };
    if (worldTween) worldTween.to = to;
    else worldTween = { to, lastFrame: performance.now() };
    if (!worldVisualFrame) worldVisualFrame = requestAnimationFrame(worldAnimateVisual);
  }
  worldAvatar.dataset.facing = player.facing;
  worldAvatar.dataset.walking = String(player.moving || Boolean(worldTween));
  worldDraw();
}

function worldReceive(player) {
  if (!worldPlayerId) return;
  if (!player || (worldPlayers.get(player.id)?.revision ?? -1) >= player.revision) return;
  worldPlayers.set(player.id, player);
  if (player.id === worldPlayerId && (!worldSaved || player.revision >= worldSaved.revision)) {
    worldSaved = player;
    // Login always starts at home. Keep earlier socket/snapshot rows for
    // revision checks, but never animate from the previous session's position.
    if (!worldPlaced && (worldSpawnRevision === null || player.revision <= worldSpawnRevision ||
      player.scene !== 'home' || player.home !== worldPlayerId || player.x !== 480 || player.y !== 475 ||
      player.facing !== 'down' || player.moving)) return;
    const firstPlacement = !worldPlaced;
    if (!worldPlaced || worldScene !== player.scene || worldHome !== player.home) {
      worldPlaced = true;
      worldApplying = true;
      worldChangeScene(player.scene, true, player.home, player);
      worldApplying = false;
    }
    worldPosition = { x: player.x, y: player.y };
    worldPresent(player);
    if (firstPlacement) worldSyncAnimation();
    if (!worldQueued && !worldSending && !worldFrame) {
      worldIntent = { ...worldPosition };
      worldIntentFacing = player.facing;
    }
    if (player.scene === 'home' && player.y > 558 && Math.abs(player.x - 480) < 55) worldChangeScene('town');
  } else worldRenderPeers();
}

function worldQueue(state) {
  if (!worldNetworked() || worldApplying) return;
  worldIntentMoving = state.moving;
  worldQueued = state;
  if (!worldSendTimer) worldSendTimer = setTimeout(worldSend, Math.max(0, worldMoveInterval - (performance.now() - worldLastSent)));
}
async function worldSend() {
  worldSendTimer = 0;
  if (worldSending || !worldQueued || !worldSaved || !worldConnected) return;
  const generation = worldGeneration, state = worldQueued, entering = !worldPlaced;
  let retryEntry = entering;
  worldQueued = null; worldSending = true; worldLastSent = performance.now();
  if (entering) worldSpawnRevision = worldSaved.revision;
  try {
    const response = await fetch('/api/world', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...state, revision: worldSaved.revision }),
    });
    const result = await response.json();
    if (generation !== worldGeneration) return;
    if (!response.ok) {
      retryEntry = entering && response.status >= 500;
      if (result.player) worldReceive(result.player);
      // The socket may have stopped the old session after our snapshot.
      // Retry entry against that newer revision instead of leaving it paused.
      if (response.status === 409 && entering && result.player) {
        if (!worldPlaced) worldChangeScene('home');
        return;
      }
      worldQueued = null; worldIntent = { ...worldPosition };
      worldStop();
      throw new Error(result.error || 'Could not move. Try again.');
    }
    worldReceive(result);
  } catch (error) {
    if (generation === worldGeneration) {
      worldQueued = null; worldIntent = { ...worldPosition };
      worldMessage(error.message || 'Connection lost. Reconnecting…');
      if (retryEntry && !worldPlaced) {
        // A transient HTTP failure need not close the socket. Keep entry
        // recoverable without requiring another refresh or a reconnect.
        worldQueued = state;
        clearTimeout(worldSendTimer);
        worldSendTimer = setTimeout(worldSend, 1000);
      }
    }
  } finally {
    if (generation === worldGeneration) {
      worldSending = false;
      if (worldQueued) worldQueue(worldQueued);
    }
  }
}

async function worldResync() {
  if (!worldNetworked()) return;
  const generation = worldGeneration, presenceBefore = worldPresenceChanges;
  try {
    const response = await fetch('/api/world', { cache: 'no-store' });
    if (!response.ok) return;
    const snapshot = await response.json();
    if (generation !== worldGeneration || !Array.isArray(snapshot.players)) return;
    if (presenceBefore === worldPresenceChanges) document.dispatchEvent(new CustomEvent('presence:updated', { detail: snapshot.online }));
    for (const player of snapshot.players) worldReceive(player);
    worldConnected = worldOnline.has(worldPlayerId);
    if (!worldPlaced && !worldSending) worldChangeScene('home');
    else if (worldQueued) worldQueue(worldQueued);
    // Loading the session pauses CSS animation as well as movement. Resume
    // both when ready, while still respecting dialogs and window visibility.
    worldSyncAnimation();
  } catch { /* The socket's next reconnect retries the snapshot. */ }
}
document.addEventListener('world:updated', event => worldReceive(event.detail));
document.addEventListener('presence:updated', event => {
  worldPresenceChanges++;
  worldOnline = new Set(event.detail);
  for (const id of worldPlayers.keys()) if (id !== worldPlayerId && !worldOnline.has(id)) worldPlayers.delete(id);
  worldRenderPeers();
});
document.addEventListener('realtime:resync', () => worldResync());
document.addEventListener('realtime:offline', () => { worldConnected = false; worldSyncAnimation(); });
document.addEventListener('adventure:pet', event => {
  if (worldPlayerId === event.detail.id) return;
  worldGeneration++; worldPlayerId = event.detail.id; worldHome = worldPlayerId;
  worldSaved = null; worldQueued = null; worldSending = false; worldConnected = false;
  worldPlaced = false; worldSpawnRevision = null;
  worldPlayers.clear(); worldIntent = { x: 480, y: 475 };
  worldResync();
});
document.addEventListener('home:visit', event => {
  if (!event.detail) return;
  worldVisitedPet = event.detail;
  worldChangeScene('home', true, event.detail.id);
});
document.addEventListener('visit:pet', event => {
  worldVisitedPet = event.detail;
  worldRenderVisit();
});
document.addEventListener('home:leave', () => worldChangeScene('town'));
const worldInteractionButtons = [...original.play.querySelectorAll('[data-touch]'), worldById('home-feed'), worldById('home-clean')];
function worldSelectInteraction(kind) {
  let label = '';
  for (const button of worldInteractionButtons) {
    const selected = (button.dataset.touch || button.id.replace('home-', '')) === kind;
    button.toggleAttribute('data-selected', selected);
    if (selected) label = button.dataset.touch ? button.textContent : kind === 'feed' ? 'Feed' : 'Clean';
  }
  worldById('home-interaction-label').textContent = label ? `Last interaction: ${label}` : 'Choose an interaction';
}
for (const button of worldInteractionButtons) button.addEventListener('click', () => worldSelectInteraction(button.dataset.touch || button.id.replace('home-', '')));
new MutationObserver(() => {
  if (homePet.dataset.reaction) worldSelectInteraction(homePet.dataset.reaction);
}).observe(homePet, { attributes: true, attributeFilter: ['data-reaction'] });

function worldMessage(text, feedback = true) {
  worldById('world-message').textContent = text;
  if (feedback && !worldDashboard.hidden && text) {
    clearTimeout(worldFeedbackTimer);
    const message = worldById('home-feedback');
    if (worldDialog.open && worldDialog.dataset.place === 'pet') {
      message.hidden = true;
      worldById('pet-reaction').textContent = text;
      return;
    }
    message.textContent = text;
    message.hidden = false;
    worldFeedbackTimer = setTimeout(() => { message.hidden = true; }, 4500);
  }
}
function worldArrangeScene(atHome) {
  for (const selector of ['.world-heading', '.world-layout > .world-companion', '.scene-caption', '.world-controls', '.world-nav']) worldShell.querySelector(selector).hidden = true;
  worldById('home-controls-tip').hidden = false;
  worldById('home-pet-label').hidden = true;
  for (const selector of ['.home-care', '.home-play', '#home-care-hint', '#home-interaction-label']) document.querySelector(selector).hidden = !atHome;
  if (!worldDashboard.hidden) worldPanels.menu.append(worldById('signout'));
  else signoutAnchor.after(worldById('signout'));
  document.body.classList.toggle('world-home', atHome && !worldDashboard.hidden);
  document.dispatchEvent(new CustomEvent('world:scene', { detail: { home: atHome && !worldVisiting() } }));
  worldStage.setAttribute('aria-describedby', 'home-controls-tip');
}
function worldCamera(point = worldNetworked() ? worldVisualPosition : worldPosition) {
  if (worldDashboard.hidden) return;
  const { width, height, viewportWidth, viewportHeight } = worldView;
  const offsetX = Math.max(viewportWidth - width, Math.min(0, viewportWidth / 2 - point.x * width / 960));
  const offsetY = Math.max(viewportHeight - height, Math.min(0, viewportHeight / 2 - point.y * height / 640));
  const transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
  if (worldCameraTransform !== transform) {
    worldStage.style.transform = transform;
    worldCameraTransform = transform;
  }
}
// Measure only when the layout changes. Walking moves two composited layers,
// without laying out the room or invalidating inherited styles on its children.
function worldResize() {
  const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
  if (!worldDashboard.hidden) {
    const scale = Math.max(viewportWidth / 960, viewportHeight / 640);
    worldView = { width: 960 * scale, height: 640 * scale, viewportWidth, viewportHeight };
    worldStage.style.setProperty('--scene-width', `${worldView.width}px`);
    worldStage.style.setProperty('--scene-height', `${worldView.height}px`);
  } else {
    worldStage.style.removeProperty('--scene-width');
    worldStage.style.removeProperty('--scene-height');
    worldStage.style.removeProperty('transform');
    worldCameraTransform = '';
    const { width, height } = worldStage.getBoundingClientRect();
    worldView = { width: width || 960, height: height || 640, viewportWidth, viewportHeight };
  }
}
window.addEventListener('resize', () => { worldResize(); worldDraw(); });
worldStage.addEventListener('focusin', event => {
  const object = event.target.closest('.home-hotspot, .town-stop');
  // Keyboard users can reach objects outside the camera. Pointer focus
  // must not move a hotspot away between pressing and releasing it.
  if (object?.matches(':focus-visible')) worldCamera({ x: parseFloat(object.style.getPropertyValue('--x')) * 9.6, y: parseFloat(object.style.getPropertyValue('--y')) * 6.4 });
});
function worldStop() {
  worldKeys.clear();
  worldPath = [];
  cancelAnimationFrame(worldFrame);
  worldFrame = 0;
  worldLastFrame = 0;
  worldSetWalking(false);
}
function worldSetWalking(walking) {
  const value = String(walking);
  if (worldNetworked() && !worldApplying) {
    // The moving request may be in flight and not visible yet. Track intent
    // so releasing a key always sends its stop, even before that first reply.
    if (!walking && worldIntentMoving) {
      worldQueue({ scene: worldScene, home: worldHome, ...worldIntent, facing: worldIntentFacing, moving: false });
    }
    return;
  }
  if (worldAvatar.dataset.walking !== value) worldAvatar.dataset.walking = value;
}
function worldModalOpen() { return Boolean(document.querySelector('dialog[open]')); }
function worldIsPaused() {
  return worldDashboard.hidden || document.hidden || !worldWindowActive || worldModalOpen() || (worldNetworked() && (!worldPlaced || !worldConnected));
}
function worldSyncAnimation() {
  const paused = worldIsPaused();
  const value = String(paused);
  if (worldAvatar.dataset.paused !== value) worldAvatar.dataset.paused = value;
  if (worldShell.dataset.paused !== value) worldShell.dataset.paused = value;
  if (paused) worldStop();
}
function worldOpenPlace(name) {
  if (name === 'pet' && worldVisiting()) name = 'visit';
  if (worldDashboard.hidden || !worldPlaces[name]) return;
  worldStop();
  const panelName = name === 'backpack' ? 'shop' : name;
  for (const [key, panel] of Object.entries(worldPanels)) panel.hidden = key !== panelName;
  worldDialog.dataset.place = name;
  worldById('world-dialog-title').textContent = worldPlaces[name][0];
  worldById('world-place-intro').textContent = worldPlaces[name][1];
  worldById('world-place-eyebrow').textContent = ['pet', 'menu'].includes(name) && worldScene === 'home' ? 'SWEET HOME' : ['backpack', 'appearance'].includes(name) ? 'YOURS TO KEEP' : 'AROUND TOWN';
  if (name === 'pet') worldById('home-feedback').hidden = true;
  if (!worldDialog.open) worldDialog.showModal();
  worldSyncAnimation();
  worldById('world-dialog-close').focus({ preventScroll: true });
}
worldById('world-dialog-close').addEventListener('click', () => worldDialog.close());
worldDialog.addEventListener('close', () => {
  if (worldDialog.open || worldDashboard.hidden || worldModalOpen()) return;
  worldStage.focus({ preventScroll: true });
  worldCamera();
});
worldDialog.addEventListener('click', (event) => {
  const box = worldDialog.getBoundingClientRect();
  if (event.target === worldDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) worldDialog.close();
});
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-place]');
  if (button && (worldShell.contains(button) || worldDialog.contains(button))) worldOpenPlace(button.dataset.place);
});
homePet.addEventListener('click', () => worldOpenPlace('pet'));

function worldChangeScene(scene, focus = true, home = worldPlayerId, confirmed = null) {
  if (worldNetworked() && !confirmed) {
    worldStop();
    if (!worldPlaced) { scene = 'home'; home = worldPlayerId; }
    worldQueue({ scene, home: scene === 'home' ? home : null, x: 480, y: scene === 'home' ? 475 : 585, facing: 'down', moving: false });
    return;
  }
  worldStop();
  if (worldDialog.open) worldDialog.close();
  worldScene = scene;
  worldHome = scene === 'home' ? home : null;
  worldStage.dataset.scene = scene;
  worldShell.dataset.scene = scene;
  worldById('home-scene').hidden = scene !== 'home';
  worldById('town-scene').hidden = scene !== 'town';
  const atHome = scene === 'home';
  clearTimeout(worldFeedbackTimer);
  worldById('home-feedback').hidden = true;
  worldArrangeScene(atHome);
  worldPosition = confirmed ? { x: confirmed.x, y: confirmed.y } : atHome ? { x: 480, y: 475 } : { x: 480, y: 585 };
  worldSnapVisual();
  worldIntent = { ...worldPosition };
  worldIntentFacing = confirmed?.facing || 'down';
  worldRenderVisit();
  if (worldVisiting()) document.dispatchEvent(new CustomEvent('home:arrived', { detail: worldHome }));
  worldById('world-title').textContent = atHome ? 'Home, sweet home.' : 'A little town. A lot to discover.';
  worldById('world-eyebrow').textContent = atHome ? 'A PLACE TO CALL YOUR OWN' : 'WELCOME TO THE NEIGHBOURHOOD';
  worldById('world-description').textContent = atHome ? 'A warm fire, a familiar face, and a little time together.' : 'Follow a path. Meet a neighbour. Make a day of it.';
  worldById('world-map').textContent = atHome ? 'Town map ↗' : 'Back home ↙';
  worldById('world-home').toggleAttribute('aria-current', atHome);
  worldById('world-town').toggleAttribute('aria-current', !atHome);
  (atHome ? worldById('world-home') : worldById('world-town')).setAttribute('aria-current', 'page');
  worldById('town-care-hint').hidden = atHome;
  worldStage.setAttribute('aria-label', `${worldVisiting() ? `${worldHome}'s home` : atHome ? 'Your home' : 'Town map'}. Move with W A S D or arrow keys. Press Space near an object to interact.`);
  worldMessage(atHome ? '' : 'The day is yours. Select a building, or walk over and press Space.', false);
  worldResize();
  worldDraw();
  if (focus && !worldDashboard.hidden) worldStage.focus({ preventScroll: true });
}
worldById('home-door').addEventListener('click', () => worldChangeScene('town'));
worldById('town-home').addEventListener('click', () => worldChangeScene('home'));
worldById('world-home').addEventListener('click', () => worldChangeScene('home'));
worldById('world-town').addEventListener('click', () => worldChangeScene('town'));
worldById('world-map').addEventListener('click', () => worldChangeScene(worldScene === 'home' ? 'town' : 'home'));

function worldCare(kind) {
  const source = worldById('items').querySelector(`[data-item="${kind}"] .chip-use`);
  if (!source || source.disabled) {
    const full = Number(worldById(`meter-${kind === 'food' ? 'stamina' : 'hygiene'}`).getAttribute('aria-valuenow')) >= 100;
    worldMessage(full ? kind === 'food' ? 'Your pet is already full of energy.' : 'Your pet is already squeaky clean.' : worldById('home-care-hint').textContent || 'Visit the shops when supplies run low.');
    return;
  }
  worldCarePending = { kind, count: Number(source.closest('[data-item]').querySelector('.item-count').textContent) };
  worldSelectInteraction(kind === 'food' ? 'feed' : 'clean');
  source.click();
}
worldById('home-feed').addEventListener('click', () => worldCare('food'));
worldById('home-clean').addEventListener('click', () => worldCare('soap'));
for (const button of worldShell.querySelectorAll('[data-home-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.homeAction;
    if (worldVisiting() && ['pet', 'feed', 'clean', 'bed', 'couch'].includes(action)) return worldOpenPlace('visit');
    if (action === 'tv') worldOpenPlace('journal');
    if (action === 'bed') worldOpenPlace('appearance');
    if (action === 'chest') worldOpenPlace('backpack');
    if (action === 'menu') worldOpenPlace('menu');
    if (action === 'feed') worldCare('food');
    if (action === 'clean') worldCare('soap');
    if (action === 'couch') {
      worldMessage('You settle into the cushions. Your pet snuggles up beside you.');
      original.play.querySelector('[data-touch="stroke"]').click();
    }
    if (action === 'fire') worldMessage('The fire crackles softly. There is no hurry here.');
    if (['feed', 'clean', 'couch', 'fire'].includes(action)) {
      worldStage.focus({ preventScroll: true });
      worldCamera();
    }
  });
}
function worldSyncCare() {
  const hints = [];
  for (const [kind, action, need] of [['food', 'feed', 'stamina'], ['soap', 'clean', 'hygiene']]) {
    const item = worldById('items').querySelector(`[data-item="${kind}"]`);
    const source = item?.querySelector('.chip-use');
    const count = Number(item?.querySelector('.item-count')?.textContent || 0);
    worldById(`home-${action}`).disabled = !source || source.disabled;
    worldById(`home-${action}-count`).textContent = `${count} left`;
    const full = Number(worldById(`meter-${need}`).getAttribute('aria-valuenow')) >= 100;
    worldById(`home-${action}`).title = full ? `${need === 'stamina' ? 'Stamina' : 'Hygiene'} is already full.` : !count ? `No ${kind} left. Collect free daily supplies in your backpack or visit the shops.` : '';
    if (!count) hints.push(`No ${kind} left`);
    if (worldCarePending?.kind === kind && count < worldCarePending.count) {
      worldCarePending = null;
      worldMessage(kind === 'food' ? 'Your pet enjoyed a tasty snack.' : 'All clean! Your pet feels fresh again.');
    }
  }
  worldById('home-care-hint').textContent = hints.length ? `${hints.join(' · ')}. Collect daily supplies in your backpack or restock in town.` : 'Feed when stamina is low. Clean when hygiene is low. Full meters mean a happy, cared-for pet.';
  worldById('home-care-error').textContent = worldById('care-error').textContent;
  worldById('home-pet-label').textContent = worldById('pet-name').textContent || 'Your companion';
  adventureEntrance.title = worldById('adventure-hint').textContent || 'Explore the woodland, solo or with a team.';
  worldDraw();
}
const worldCareObserver = new MutationObserver(worldSyncCare);
for (const id of ['items', 'care-error', 'pet-name', 'meter-stamina', 'meter-hygiene', 'adventure-hint']) worldCareObserver.observe(worldById(id), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-valuenow'] });
worldSyncCare();
new MutationObserver(() => {
  const error = worldById('care-error').textContent;
  if (error) { worldCarePending = null; worldMessage(error); }
}).observe(worldById('care-error'), { childList: true, characterData: true, subtree: true });
new MutationObserver(() => {
  const reaction = worldById('pet-reaction').textContent;
  if (reaction && !worldDialog.open) worldMessage(reaction);
}).observe(worldById('pet-reaction'), { childList: true, characterData: true, subtree: true });

const worldAlertsObserver = new MutationObserver(() => {
  const count = worldById('theft-list').children.length;
  const error = Boolean(worldById('theft-error').textContent);
  worldById('world-journal').textContent = count ? `Journal · ${count} ${count === 1 ? 'report' : 'reports'}` : error ? 'Journal · check reports' : 'Journal';
  worldById('world-journal').classList.toggle('has-alerts', count > 0 || error);
  journalEmpty.hidden = !worldById('theft-notifications').hidden;
});
worldAlertsObserver.observe(worldById('theft-notifications'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

// Positions are cosmetic navigation only. They do not create a second copy of
// pet state or change stamina, money, timers, or any Adventure coordinates.
const worldObstacles = {
  home: [
    [148, 164, 140, 64], [91, 215, 43, 48], [124, 268, 182, 107], [681, 174, 140, 48], [684, 252, 126, 123], [610, 409, 87, 30], [735, 430, 145, 97], [855, 315, 35, 108], [101, 473, 44, 71], [330, 461, 72, 41],
    // The pet occupies the rug too. Player coordinates are their feet, so
    // leave enough space below the pet for the character's head and body.
    [428, 300, 104, 128],
  ],
  town: [
    [401, 421, 162, 135], [112, 237, 184, 126], [162, 51, 176, 126], [399, 71, 166, 145], [659, 291, 186, 134], [428, 287, 88, 60], [714, 97, 13, 80], [777, 97, 13, 80],
    // Garden rails are solid, with the front gate and soil left walkable.
    [150, 488, 178, 22], [150, 582, 61, 22], [270, 582, 58, 22],
  ],
};
function worldWalkable(x, y) {
  const bounds = worldScene === 'home' ? [76, 174, 884, 570] : [44, 30, 870, 614];
  if (x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3]) return false;
  return !worldObstacles[worldScene].some(([left, top, width, height]) => x > left - 9 && x < left + width + 9 && y > top - 5 && y < top + height + 10);
}
function worldTargets() {
  if (worldScene === 'home') return [
    [220, 241, 'Watch town TV', '[data-home-action="tv"]'], [215, 390, 'Sit on the couch', '[data-home-action="couch"]'],
    [748, 237, 'Warm up by the fire', '[data-home-action="fire"]'], [748, 391, "Visit your pet's nook", '[data-home-action="bed"]'],
    [649, 458, 'Feed your pet', '[data-home-action="feed"]'], [808, 540, 'Clean your pet', '[data-home-action="clean"]'],
    [480, 375, 'Spend time with your pet', '[data-home-action="pet"]', 90], [480, 565, 'Leave for town', '#home-door'],
    [366, 525, 'Open your backpack', '[data-home-action="chest"]'], [350, 220, 'Game menu', '[data-home-action="menu"]'],
  ];
  return [[250, 194, 'Browse part-time jobs', '[data-place="work"]'], [482, 233, 'Visit school', '[data-place="school"]'], [751, 189, 'Enter the woodland', '#adventure-open'], [204, 379, 'Visit the shops', '[data-place="shop"]'], [752, 440, 'Enter the arena', '[data-place="arena"]'], [482, 571, 'Go home', '#town-home']];
}
function worldHighlight(destination) {
  const target = !worldDashboard.hidden && !worldModalOpen() && destination && !destination.disabled ? destination : null;
  // Only touch the highlight when the interaction target changes. Walking
  // within one object's range must not repaint its indicator every frame.
  if (target === worldHighlighted) return;
  worldHighlighted?.classList.remove('is-interactable');
  worldHighlighted = target;
  worldHighlighted?.classList.add('is-interactable');
  // Trace the furniture itself, independently of its generous click area.
  // The pet keeps a floor ring attached to its live sprite.
  const action = target?.dataset.homeAction;
  const outline = action && action !== 'pet';
  homeInteractionOutline.toggleAttribute('hidden', !outline);
  if (outline) {
    for (const stroke of homeOutlineStrokes) stroke.setAttribute('href', `/scenes/home-highlights.svg#${action}`);
  }
  const townAction = target?.dataset.townAction;
  townInteractionOutline.toggleAttribute('hidden', !townAction);
  if (townAction) {
    for (const stroke of townOutlineStrokes) stroke.setAttribute('href', `/scenes/town-highlights.svg#${townAction}`);
  }
}
function worldDrawPosition() {
  const displayed = worldNetworked() ? worldVisualPosition : worldPosition;
  const transform = `translate3d(${displayed.x * worldView.width / 960}px, ${displayed.y * worldView.height / 640}px, 0) translate(-50%, -100%)`;
  if (worldAvatarTransform !== transform) {
    worldAvatar.style.transform = transform;
    worldAvatarTransform = transform;
  }
  worldCamera();
}
function worldDraw() {
  worldDrawPosition();
  const choices = worldTargets().map((target) => ({ target, distance: Math.hypot(target[0] - worldPosition.x, target[1] - worldPosition.y) })).sort((a, b) => a.distance - b.distance);
  const nearest = choices[0];
  // The pet's wider body clearance must still allow interaction from every
  // side, including when a slower frame stops a few pixels before its edge.
  worldNearest = nearest?.distance <= (nearest?.target[4] ?? 82) ? nearest.target : null;
  const control = worldById('world-interact');
  const destination = worldNearest && worldShell.querySelector(worldNearest[3]);
  const disabled = !destination || destination.disabled;
  const label = worldNearest ? `${worldNearest[2]} · Space` : 'Move closer to interact';
  if (control.disabled !== disabled) control.disabled = disabled;
  if (control.textContent !== label) control.textContent = label;
  worldHighlight(destination);
  worldRenderPeers();
}
// Dialogs and destination availability can change while the player stands
// still, so keep their highlight in sync without a polling animation loop.
const worldAvailabilityObserver = new MutationObserver(records => {
  if (records.some(record => record.target.tagName === 'DIALOG')) worldSyncAnimation();
  if (records.some(record => record.attributeName === 'disabled')) worldDraw();
  else if (records.some(record => record.target.tagName === 'DIALOG')) {
    worldHighlight(worldNearest && worldShell.querySelector(worldNearest[3]));
  }
});
worldAvailabilityObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
worldAvailabilityObserver.observe(worldStage, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
worldById('world-interact').addEventListener('click', () => {
  if (worldNearest && !worldModalOpen()) worldShell.querySelector(worldNearest[3])?.click();
});

const worldDirections = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
function worldMove(dx, dy) {
  if (worldWalkable(worldPosition.x + dx, worldPosition.y)) worldPosition.x += dx;
  if (worldWalkable(worldPosition.x, worldPosition.y + dy)) worldPosition.y += dy;
}
function worldTick(now) {
  worldFrame = 0;
  if (worldIsPaused()) return worldStop();
  const seconds = Math.min(Math.max((now - worldLastFrame) / 1000, 0), .04);
  worldLastFrame = now;
  const confirmed = worldPosition;
  if (worldNetworked()) worldPosition = { ...worldIntent };
  const previous = { ...worldPosition };
  let dx = 0, dy = 0;
  for (const key of worldKeys) { dx += worldDirections[key][0]; dy += worldDirections[key][1]; }
  const distance = Math.hypot(dx, dy);
  if (distance) worldMove(dx / distance * worldWalkSpeed * seconds, dy / distance * worldWalkSpeed * seconds);
  if (!worldKeys.size && worldPath.length) {
    // Spend the whole frame's travel, including across route corners. Stopping
    // for a frame at every grid node made floor-click walking visibly stutter.
    let remaining = worldWalkSpeed * seconds;
    while (worldPath.length && remaining > 0) {
      const next = worldPath[0];
      const dx = next.x - worldPosition.x, dy = next.y - worldPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance < .000001) { worldPath.shift(); continue; }
      const step = Math.min(remaining, distance);
      const before = { ...worldPosition };
      worldMove(dx / distance * step, dy / distance * step);
      if (worldPosition.x === before.x && worldPosition.y === before.y) { worldPath = []; break; }
      remaining -= step;
      if (step === distance) worldPath.shift();
    }
  }
  dx = worldPosition.x - previous.x; dy = worldPosition.y - previous.y;
  const moved = dx !== 0 || dy !== 0;
  if (moved) {
    // Subtracting positions introduces tiny rounding differences in equal
    // diagonal steps. Keep ties stable so views and walk cycles do not flicker.
    // Use actual travel so sliding along a wall still faces the unblocked axis.
    const facing = Math.abs(dx) > Math.abs(dy) + .000001 ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
    if (worldNetworked()) {
      worldIntent = { ...worldPosition };
      worldIntentFacing = facing;
      worldQueue({ scene: worldScene, home: worldHome, ...worldIntent, facing, moving: true });
    } else {
      if (worldAvatar.dataset.facing !== facing) worldAvatar.dataset.facing = facing;
      worldDraw();
      if (worldScene === 'home' && worldPosition.y > 558 && Math.abs(worldPosition.x - 480) < 55) return worldChangeScene('town');
    }
  }
  if (worldNetworked()) worldPosition = confirmed;
  worldSetWalking(moved);
  if (worldKeys.size || worldPath.length) worldFrame = requestAnimationFrame(worldTick);
  else worldStop();
}
function worldScheduleWalk() {
  if (worldFrame) return;
  worldLastFrame = performance.now();
  worldFrame = requestAnimationFrame(worldTick);
}
function worldStartWalk(key) {
  if (worldIsPaused()) return;
  worldPath = [];
  worldKeys.add(key);
  worldScheduleWalk();
}
document.addEventListener('keydown', (event) => {
  if (worldIsPaused() || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // A key held in the sign-in form (or across a pause) must be released and
  // pressed again. Ongoing walking already runs on its own animation frame.
  if (worldDirections[key] && event.repeat) return;
  if (key === 'Escape' && worldStage.contains(event.target)) { event.preventDefault(); worldOpenPlace('menu'); return; }
  // Adventure dialogs restore focus to their entrance. Direction keys should
  // resume walking from focused scene objects; Space/Enter still activate them.
  if (worldDirections[key] && worldStage.contains(event.target) && event.target.closest?.('.home-hotspot, .town-stop, #pet-touch, #world-visit-pet')) {
    event.preventDefault();
    worldStage.focus({ preventScroll: true });
    worldStartWalk(key);
    return;
  }
  if (event.target !== worldStage) return;
  if (worldDirections[key]) { event.preventDefault(); worldStartWalk(key); }
  if (['e', 'Enter', ' '].includes(key)) { event.preventDefault(); if (!event.repeat) worldById('world-interact').click(); }
});
document.addEventListener('keyup', (event) => {
  worldKeys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
});
window.addEventListener('blur', () => { worldWindowActive = false; worldSyncAnimation(); });
window.addEventListener('focus', () => { worldWindowActive = true; worldSyncAnimation(); });
document.addEventListener('visibilitychange', worldSyncAnimation);
worldStage.addEventListener('blur', worldStop);
for (const button of worldShell.querySelectorAll('[data-world-direction]')) {
  const key = { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight' }[button.dataset.worldDirection];
  button.addEventListener('pointerdown', (event) => { event.preventDefault(); worldStage.focus({ preventScroll: true }); button.setPointerCapture?.(event.pointerId); worldStartWalk(key); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => worldKeys.delete(key));
  button.addEventListener('click', (event) => {
    if (event.detail !== 0 || worldIsPaused()) return;
    const [dx, dy] = worldDirections[key];
    const x = worldPosition.x + dx * 20, y = worldPosition.y + dy * 20;
    if (worldWalkable(x, y)) {
      if (worldNetworked()) {
        worldIntent = { x, y };
        worldIntentFacing = button.dataset.worldDirection;
        worldQueue({ scene: worldScene, home: worldHome, x, y, facing: button.dataset.worldDirection, moving: false });
        return;
      }
      worldPosition = { x, y };
    }
    if (worldScene === 'home' && worldPosition.y > 558 && Math.abs(worldPosition.x - 480) < 55) return worldChangeScene('town');
    worldDraw();
  });
}

// A small breadth-first grid route lets a floor click walk around furniture.
// Hotspots remain direct shortcuts, including on small touch screens.
worldStage.addEventListener('click', (event) => {
  if (event.target.closest('button, #pet-touch') || worldIsPaused()) return;
  const rect = worldStage.getBoundingClientRect();
  worldStage.focus({ preventScroll: true });
  if (!rect.width || !rect.height) return;
  const end = { x: Math.round((event.clientX - rect.left) * 960 / rect.width / 20), y: Math.round((event.clientY - rect.top) * 640 / rect.height / 20) };
  if (!worldWalkable(end.x * 20, end.y * 20)) { worldMessage('That spot is occupied. Choose a clear patch of floor or a path.'); return; }
  worldStop();
  // Rounding a position beside a wall can put the first grid node *inside*
  // that wall. Choose a nearby free node with a clear approach instead.
  // Continue from the requested travel rather than stepping back to an older
  // acknowledgement when a new floor click arrives during a network request.
  const origin = worldNetworked() ? worldIntent : worldPosition;
  const rounded = { x: Math.round(origin.x / 20), y: Math.round(origin.y / 20) };
  const starts = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const point = { x: rounded.x + dx, y: rounded.y + dy };
    const distance = Math.hypot(point.x * 20 - origin.x, point.y * 20 - origin.y);
    const steps = Math.max(1, Math.ceil(distance / 4));
    let clear = true;
    for (let step = 1; step <= steps; step++) {
      if (!worldWalkable(origin.x + (point.x * 20 - origin.x) * step / steps,
        origin.y + (point.y * 20 - origin.y) * step / steps)) { clear = false; break; }
    }
    if (clear) starts.push({ point, distance });
  }
  const start = starts.sort((a, b) => a.distance - b.distance)[0]?.point;
  if (!start) return worldMessage('There is no clear path there. Try another spot.');
  const queue = [start], visited = new Map([[`${start.x},${start.y}`, null]]);
  let found = false;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === end.x && current.y === end.y) { found = true; break; }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
      if (visited.has(key) || !worldWalkable(next.x * 20, next.y * 20)) continue;
      visited.set(key, current); queue.push(next);
    }
  }
  if (!found) return worldMessage('There is no clear path there. Try another spot.');
  for (let point = end; point; point = visited.get(`${point.x},${point.y}`)) worldPath.unshift({ x: point.x * 20, y: point.y * 20 });
  worldScheduleWalk();
});

// Preserve normal arrow-key navigation in the Arena's actual tabs.
const arenaTabs = original.arena.querySelector('.arena-tabs');
arenaTabs.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...arenaTabs.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});

document.addEventListener('adventure:reset', () => { worldCarePending = null; worldSelectInteraction(null); worldChangeScene('home', false); });
document.addEventListener('battle:show', worldStop);
document.addEventListener('confirm:ask', worldStop);
adventureEntrance.addEventListener('click', worldStop);
function worldSyncSession() {
  const visible = !worldDashboard.hidden;
  if (!visible && worldPlayerId) {
    worldGeneration++; worldPlayerId = null; worldSaved = null; worldQueued = null; worldSending = false;
    worldPlayers.clear(); worldOnline.clear(); worldRenderPeers();
  }
  document.body.classList.toggle('world-playing', visible);
  if (!visible || !worldWasVisible) worldChangeScene('home', visible);
  if (visible && !worldWasVisible) {
    // Lay out the room immediately; a pending live position must not leave
    // the initial scene cropped or waiting for the socket to reconnect.
    worldArrangeScene(worldScene === 'home');
    worldResize();
    worldDraw();
  }
  worldWasVisible = visible;
  worldSyncAnimation();
}
new MutationObserver(worldSyncSession).observe(worldDashboard, { attributes: true, attributeFilter: ['hidden'] });
worldSyncSession();
worldDraw();
