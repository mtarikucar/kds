export const MASCOT_DIALOGUES = {
  // Exterior scene - shown sequentially when mascot is clicked
  exterior: [
    'Merhaba! Ben Sef Hummy!',
    'Burasi senin restoranin!',
    'Binaya tiklayarak iceri girebilirsin',
  ],

  // Interior scene - shown randomly when mascot is clicked
  interior: [
    'Masalari surukleyerek hareket ettirebilirsin!',
    'Edit Layout ile duzenleme moduna gec',
    '2D gorunume gecerek usten bakabilirsin',
    'Scroll ile yakinlasip uzaklasabilirsin',
    'Shift+surukle ile kamerayi kaydir',
    'Masalari secip donus simgesine tiklayarak cevirebilirsin',
    'Yeni masa eklemek icin sol taraftaki menuyu kullan',
  ],
} as const

export type DialoguePhase = keyof typeof MASCOT_DIALOGUES
