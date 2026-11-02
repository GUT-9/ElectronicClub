<template>
  <div
    class="circuit-board"
    role="img"
    aria-label="电路走线、芯片与信号波形的原创工程示意图，非真实社团项目"
  >
    <div class="board-top">
      <span>EC / ENGINEERING STUDY</span><span class="board-led">SIGNAL</span>
    </div>
    <svg viewBox="0 0 600 430" fill="none" aria-hidden="true">
      <defs>
        <pattern
          id="pcb-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill="currentColor" opacity=".15" />
        </pattern>
      </defs>
      <path fill="url(#pcb-grid)" d="M0 0h600v430H0z" />
      <g stroke="currentColor" stroke-width="1.5" opacity=".5">
        <path
          d="M0 72h126l70 70h40M0 96h114l64 64h58M0 120h102l58 58h76M0 338h114l88-88h34M0 362h126l94-94h16M300 0v88M324 0v88M348 0v88M372 0v112l-18 18M600 80H486l-78 78h-44M600 104H498l-72 72h-62M600 128H510l-66 66h-80M600 298H478l-62-62h-52M600 322H466l-68-68h-34M276 286v56l-40 40v48M300 286v68l-40 40v36M324 286v80l-40 40v24"
        />
        <circle cx="126" cy="72" r="4" />
        <circle cx="114" cy="338" r="4" />
        <circle cx="486" cy="80" r="4" />
        <circle cx="478" cy="298" r="4" />
      </g>
      <g stroke="currentColor" stroke-width="2">
        <path
          d="M246 128v-16m20 16v-16m20 16v-16m20 16v-16m20 16v-16m20 16v-16M246 274v16m20-16v16m20-16v16m20-16v16m20-16v16m20-16v16M226 148h-16m16 20h-16m16 20h-16m16 20h-16m16 20h-16m16 20h-16M368 148h16m-16 20h16m-16 20h16m-16 20h16m-16 20h16m-16 20h16"
        />
      </g>
      <rect
        x="226"
        y="128"
        width="142"
        height="146"
        rx="3"
        fill="#103f90"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <rect
        x="237"
        y="139"
        width="120"
        height="124"
        rx="1"
        stroke="currentColor"
        opacity=".3"
      />
      <circle cx="249" cy="151" r="3" fill="#ff5261" />
      <text
        x="297"
        y="197"
        text-anchor="middle"
        fill="white"
        font-size="20"
        font-family="monospace"
        letter-spacing="3"
      >
        EXPLORE
      </text>
      <text
        x="297"
        y="222"
        text-anchor="middle"
        fill="currentColor"
        font-size="10"
        font-family="monospace"
        letter-spacing="2"
      >
        BUILD · ITERATE
      </text>
      <g stroke="currentColor" opacity=".65">
        <path
          d="M48 203h80v48H48zM48 227h80M88 203v48M448 354h110v48H448zM452 378h102"
        />
        <path
          d="M452 378h12l7-14 13 28 12-28 13 28 10-14h35"
          stroke-width="1.5"
        />
      </g>
      <g fill="currentColor" font-size="9" font-family="monospace" opacity=".8">
        <text x="48" y="192">01 / MEASURE</text>
        <text x="448" y="343">02 / SIGNAL</text>
        <text x="420" y="52">VCC</text>
        <text x="188" y="407">GND</text>
      </g>
      <path d="M0 72h126l70 70h20" stroke="#ff5261" stroke-width="2" />
    </svg>
    <div class="board-bottom">
      <span>从原理，到作品。</span><span>DESIGNED TO EXPLORE ↗</span>
    </div>
  </div>
</template>
