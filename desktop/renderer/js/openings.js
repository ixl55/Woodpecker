// Opening repertoire for the Learn section: well-known main lines, written as SAN with a short reason in
// {braces} after the moves of the side you play. test/openings.test.js plays every line on a board, so
// every move is legal, every move of yours has a reason, and every trap really ends in mate.

/** 'e4 {why} e5 Nf3 {why}' -> { moves: ['e4', 'e5', 'Nf3'], notes: ['why', undefined, 'why'] } */
function parse(text) {
  const moves = [];
  const notes = [];
  const re = /\{([^}]*)\}|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) notes[moves.length - 1] = m[1].trim();
    else moves.push(m[2]);
  }
  return { moves, notes: moves.map((_, i) => notes[i]) };
}

function opening(id, name, side, eco, idea, lines, kind = 'opening') {
  const parsed = lines.map(([lineName, text], i) => ({ id: `${id}-${i + 1}`, name: lineName, ...parse(text) }));
  // lines that start the same way share the reasons written once for that shared start
  const known = new Map();
  for (const line of parsed) line.notes.forEach((note, i) => { if (note) known.set(line.moves.slice(0, i + 1).join(' '), note); });
  for (const line of parsed) line.notes = line.notes.map((note, i) => note ?? known.get(line.moves.slice(0, i + 1).join(' ')));
  return { id, name, side, eco, idea, kind, lines: parsed };
}

/** A short opening trap: one line, what it wins, and how the tests prove it. */
function trap(id, name, side, eco, result, idea, text, { proof = 'mate', gain = 0 } = {}) {
  return { ...opening(id, name, side, eco, idea, [['The trap', text]], 'trap'), result, proof, gain };
}

export const OPENINGS = [
  // ------------------------------------------------------------ White
  opening('italian', 'Italian Game', 'w', 'C50',
    'White develops fast, aims the bishop at f7 and prepares d4 with c3. Usually a slow, strategic game where both sides castle and manoeuvre.', [
      ['Giuoco Pianissimo', `e4 {Takes a centre square and opens lines for the queen and the bishop.} e5
        Nf3 {Develops towards the centre and attacks the pawn on e5.} Nc6
        Bc4 {The Italian bishop aims at f7, the square only the king defends.} Bc5
        c3 {Prepares d4 to take more of the centre.} Nf6
        d3 {Protects e4 calmly and keeps the centre closed for a slow fight.} d6
        O-O {Gets the king safe before the centre opens.} O-O
        Re1 {The rook supports e4 and backs up a later d4.} a6
        Bb3 {Steps back before ...b5 can chase it, still aiming at f7.} Ba7
        h3 {Stops ...Bg4 and ...Ng4, a useful move before d4.}`],
      ['Two Knights, 4.d3', `e4 e5 Nf3 Nc6 Bc4 Nf6
        d3 {Protects e4 simply. The sharp 4.Ng5 exists, but 4.d3 keeps the game calm.} Be7
        O-O {Castles quickly.} O-O
        Re1 {Supports e4 and prepares c3 and d4.} d6
        c3 {Prepares d4 and gives the bishop a retreat on c2.}`],
      ['Evans Gambit', `e4 e5 Nf3 Nc6 Bc4 Bc5
        b4 {The Evans Gambit: a pawn for time to play c3 and d4.} Bxb4
        c3 {Hits the bishop and prepares d4 with gain of time.} Ba5
        d4 {Opens the centre while White is ahead in development.} exd4
        O-O {Castles; White's pieces come into the open centre fast.}`],
    ]),
  opening('ruy-lopez', 'Ruy Lopez', 'w', 'C60',
    'White attacks the knight that defends e5. The pressure on Black\'s centre lasts a long time, and White often builds a slow kingside attack.', [
      ['Closed Ruy Lopez', `e4 {Takes a centre square.} e5
        Nf3 {Develops and attacks e5.} Nc6
        Bb5 {Attacks the knight that defends e5.} a6
        Ba4 {Keeps the pressure on the knight instead of trading.} Nf6
        O-O {Castles. If ...Nxe4, White wins the pawn back with Re1 or d4.} Be7
        Re1 {Protects e4, so Bxc6 followed by Nxe5 becomes a real threat.} b5
        Bb3 {The bishop steps back but keeps aiming at f7.} d6
        c3 {Makes room for the bishop on c2 and prepares d4.} O-O
        h3 {Stops ...Bg4, so d4 can come next.}`],
      ['Berlin Defence', `e4 e5 Nf3 Nc6 Bb5 Nf6
        O-O {Castles and lets Black take on e4.} Nxe4
        d4 {Opens the centre to win the pawn back.} Nd6
        Bxc6 {Gives the bishop to double Black's pawns.} dxc6
        dxe5 {Takes back the pawn and chases the knight.} Nf5
        Qxd8+ {The Berlin endgame: Black has the bishop pair, White the healthier pawn majority.}`],
      ['Exchange Variation', `e4 e5 Nf3 Nc6 Bb5 a6
        Bxc6 {Gives up the bishop to damage Black's pawns.} dxc6
        O-O {Castles first: Nxe5 at once would fail to ...Qd4.} f6
        d4 {Opens the centre.} exd4
        Nxd4 {Recaptures in the centre.} c5
        Nb3 {Retreats and offers a queen trade.} Qxd1
        Rxd1 {An endgame where White's four-against-three kingside majority counts.}`],
    ]),
  opening('scotch', 'Scotch Game', 'w', 'C45',
    'White opens the centre at once with d4. Open, direct play with fewer long manoeuvres than in the Italian or the Ruy Lopez.', [
      ['Classical 4...Bc5', `e4 {Takes a centre square.} e5
        Nf3 {Develops and attacks e5.} Nc6
        d4 {Strikes at the centre straight away.} exd4
        Nxd4 {Recaptures with a knight in the centre.} Bc5
        Be3 {Defends the knight and develops.} Qf6
        c3 {A third defender for the knight on d4.} Nge7
        Bc4 {Develops with an eye on f7.}`],
      ['Mieses 4...Nf6', `e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6
        Nxc6 {Trades knights to damage Black's pawns.} bxc6
        e5 {Chases the knight from f6.} Qe7
        Qe2 {Unpins the pawn and defends e5.} Nd5
        c4 {Kicks the knight away from the centre.}`],
    ]),
  opening('kings-gambit', 'King\'s Gambit', 'w', 'C30',
    'White offers the f-pawn to open the f-file and take the centre. Sharp and old-fashioned, with attacking chances for both sides.', [
      ['Accepted, Kieseritzky', `e4 {Takes a centre square.} e5
        f4 {The gambit: offers a pawn to deflect e5 and open the f-file.} exf4
        Nf3 {Develops and stops ...Qh4+.} g5
        h4 {Undermines the pawn on g5 at once.} g4
        Ne5 {The Kieseritzky: the knight jumps to a strong central square.} Nf6
        Bc4 {Develops and aims at f7.} d5
        exd5 {Takes the pawn and opens the bishop's diagonal further.}`],
      ['Declined, 2...Bc5', `e4 e5 f4 Bc5
        Nf3 {Develops and guards h4.} d6
        Nc3 {Develops and guards e4.} Nf6
        Bc4 {Develops and aims at f7.} Nc6
        d3 {Protects e4 and opens the path of the queen's bishop.}`],
    ]),
  opening('vienna', 'Vienna Game', 'w', 'C25',
    'White develops the queen\'s knight first and keeps the f-pawn free. It can be played quietly with g3 or sharply with f4.', [
      ['Fianchetto 3.g3', `e4 {Takes a centre square.} e5
        Nc3 {Develops and guards e4, keeping the f-pawn free to advance.} Nf6
        g3 {Prepares the bishop on the long diagonal.} d5
        exd5 {Trades to open the long diagonal.} Nxd5
        Bg2 {The bishop presses d5 and the whole diagonal.} Nxc3
        bxc3 {Recaptures towards the centre.} Bd6
        Nf3 {Develops and attacks e5.} O-O
        O-O {Castles; the bishop on g2 and the open b-file give White play.}`],
      ['Vienna Gambit', `e4 e5 Nc3 Nf6
        f4 {The Vienna Gambit: strikes at e5 with the f-pawn.} d5
        fxe5 {Takes on e5 and gains space.} Nxe4
        Nf3 {Develops and defends e5.}`],
    ]),
  opening('queens-gambit', 'Queen\'s Gambit', 'w', 'D06',
    'White offers the c-pawn to pull Black\'s d-pawn away from the centre. If Black takes, White wins it back easily; if not, White keeps steady pressure.', [
      ['Declined, Tartakower', `d4 {Takes the centre; the queen already defends this pawn.} d5
        c4 {The gambit: attacks d5 to lure it away from the centre.} e6
        Nc3 {Develops and adds pressure on d5.} Nf6
        Bg5 {Pins the knight that defends d5.} Be7
        e3 {Supports d4 and opens the light-squared bishop.} O-O
        Nf3 {Develops the king's knight.} h6
        Bh4 {Keeps the pin.} b6
        Be2 {Develops and prepares to castle.}`],
      ['Accepted', `d4 d5 c4 dxc4
        Nf3 {Develops and stops ...e5.} Nf6
        e3 {Opens the bishop's path to win back c4.} e6
        Bxc4 {Regains the pawn with a free position.} c5
        O-O {Castles.}`],
      ['Slav', `d4 d5 c4 c6
        Nf3 {Develops.} Nf6
        Nc3 {Develops and adds pressure on d5.} dxc4
        a4 {Stops ...b5, which would hold on to the extra pawn.} Bf5
        e3 {Prepares to take back on c4.} e6
        Bxc4 {Regains the pawn.} Bb4
        O-O {Castles.}`],
    ]),
  opening('london', 'London System', 'w', 'D02',
    'A system: White sets up the same way against almost anything, with d4, Bf4, e3, c3 and Nd2. Solid and easy to learn.', [
      ['Against ...d5', `d4 {Takes the centre.} d5
        Bf4 {The London bishop, developed before e3 shuts it in.} Nf6
        e3 {Supports d4 and opens the other bishop.} c5
        c3 {Holds d4 firmly: the pawn triangle c3, d4, e3.} Nc6
        Nd2 {Develops behind the pawns and keeps f3 for the other knight.} e6
        Ngf3 {Develops and defends d4.} Bd6
        Bg3 {Keeps the bishop when Black offers a trade on d6.} O-O
        Bd3 {Develops the last minor piece, aiming at the kingside.}`],
      ['Against ...g6', `d4 {Takes the centre.} Nf6
        Bf4 {The bishop comes out early, before e3.} g6
        e3 {Supports d4.} Bg7
        Nf3 {Develops.} O-O
        Be2 {A modest square, so the king can castle quickly.} d6
        h3 {Gives the bishop a retreat on h2 if ...Nh5 comes.}`],
    ]),
  opening('english', 'English Opening', 'w', 'A10',
    'White starts on the wing with c4 and controls d5 from the side. Flexible play, often a Sicilian with colours reversed and an extra move.', [
      ['Reversed Sicilian', `c4 {Controls d5 from the side and keeps options open.} e5
        Nc3 {Develops and adds control of d5.} Nf6
        g3 {Prepares the bishop on g2, on the long diagonal.} d5
        cxd5 {Trades the c-pawn for Black's centre pawn.} Nxd5
        Bg2 {Hits the knight on d5 and the whole diagonal.} Nb6
        Nf3 {Develops and attacks e5.} Nc6
        O-O {Castles.}`],
      ['Symmetrical', `c4 {Controls d5 from the side.} c5
        Nc3 {Develops and watches d5.} Nc6
        g3 {Prepares the fianchetto.} g6
        Bg2 {Aims down the long diagonal at the queenside.} Bg7
        Nf3 {Develops.} e6
        O-O {Castles.} Nge7
        d3 {Opens the path of the dark-squared bishop and supports a later e4.}`],
    ]),
  opening('catalan', 'Catalan', 'w', 'E01',
    'A Queen\'s Gambit with the bishop on g2. White often lets the c4 pawn go for a while; the long-diagonal bishop presses Black\'s queenside all game.', [
      ['Open Catalan', `d4 {Takes the centre.} Nf6
        c4 {Takes more of the centre.} e6
        g3 {Prepares the Catalan bishop on g2.} d5
        Bg2 {The bishop aims along the long diagonal at b7.} Be7
        Nf3 {Develops.} O-O
        O-O {Castles.} dxc4
        Qc2 {Prepares to win the pawn back with the queen.} a6
        Qxc4 {Regains the pawn.} b5
        Qc2 {Steps back; the queen keeps an eye on the c-file and e4.} Bb7
        Bd2 {Develops the dark-squared bishop.}`],
    ]),

  // ------------------------------------------------------------ Black
  opening('sicilian', 'Sicilian Defence', 'b', 'B20',
    'Black fights for d4 from the side with ...c5. An unbalanced game: White often attacks on the kingside, Black counterattacks on the queenside and the c-file.', [
      ['Najdorf, 6.Be2', `e4 c5 {Controls d4 without copying White: an unbalanced fight from move one.}
        Nf3 d6 {Stops e5 and prepares ...Nf6.}
        d4 cxd4 {Trades a wing pawn for White's centre pawn.}
        Nxd4 Nf6 {Develops and attacks e4.}
        Nc3 a6 {The Najdorf: keeps White's pieces off b5 and prepares ...e5 or ...b5.}
        Be2 e5 {Kicks the knight from the centre and takes space.}
        Nb3 Be7 {Develops, ready to castle.}
        O-O O-O {Castles.}`],
      ['Najdorf, English Attack', `e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6
        Be3 e5 {Kicks the knight and takes space.}
        Nb3 Be6 {Develops and watches the queenside.}
        f3 Be7 {Develops, ready to castle.}
        Qd2 O-O {Castles; Black's counterplay comes on the queenside with ...b5.}`],
      ['Dragon', `e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6
        Nc3 g6 {The Dragon: the bishop will rule the long diagonal.}
        Be3 Bg7 {The Dragon bishop aims at d4 and b2.}
        f3 O-O {Castles.}
        Qd2 Nc6 {Develops and hits the knight on d4.}
        Bc4 Bd7 {Develops and prepares ...Rc8 on the open c-file.}`],
      ['Against 2.c3', `e4 c5
        c3 Nf6 {Attacks e4 at once.}
        e5 Nd5 {The knight finds a strong central square.}
        d4 cxd4 {Trades before White builds a full centre.}
        Nf3 Nc6 {Develops and hits d4 and e5.}
        cxd4 d6 {Challenges the pawn on e5.}`],
    ]),
  opening('french', 'French Defence', 'b', 'C00',
    'Black builds a solid chain with ...e6 and ...d5. The price is a cramped light-squared bishop; the reward is steady counterplay with ...c5 and ...f6.', [
      ['Classical 3...Nf6', `e4 e6 {Prepares ...d5 with pawn support.}
        d4 d5 {Challenges e4 at once.}
        Nc3 Nf6 {Develops and attacks e4 again.}
        Bg5 Be7 {Unpins the knight.}
        e5 Nfd7 {Steps back; the knight will support ...c5.}
        Bxe7 Qxe7 {Recaptures, keeping the queen near the king.}
        f4 O-O {Castles.}
        Nf3 c5 {The typical French strike at White's centre.}`],
      ['Advance', `e4 e6 d4 d5
        e5 c5 {Attacks the base of White's chain at once.}
        c3 Nc6 {Adds pressure on d4.}
        Nf3 Qb6 {A third attacker on d4; the queen also hits b2.}
        a3 c4 {Gains queenside space and keeps White's pieces off b3 and d3.}`],
      ['Winawer', `e4 e6 d4 d5
        Nc3 Bb4 {The Winawer: pins the knight that defends e4.}
        e5 c5 {Strikes at d4 right away.}
        a3 Bxc3+ {Gives the bishop to double White's pawns.}
        bxc3 Ne7 {Develops; the knight can go to f5 or c6.}
        Qg4 O-O {Castles; Black's play will be against White's weak queenside pawns.}`],
    ]),
  opening('caro-kann', 'Caro-Kann Defence', 'b', 'B10',
    'Black supports ...d5 with the c-pawn and keeps the light-squared bishop free. Solid, with a healthy pawn structure.', [
      ['Classical 4...Bf5', `e4 c6 {Prepares ...d5 without shutting in the c8 bishop.}
        d4 d5 {Challenges e4.}
        Nc3 dxe4 {Gives up the centre pawn to free the game.}
        Nxe4 Bf5 {Develops outside the pawn chain and hits the knight.}
        Ng3 Bg6 {Steps back and stays on the diagonal.}
        h4 h6 {Gives the bishop a retreat on h7 before h5 can trap it.}
        Nf3 Nd7 {Develops and stops Ne5.}
        h5 Bh7 {The bishop keeps its diagonal.}
        Bd3 Bxd3 {Trades off White's best bishop.}
        Qxd3 e6 {Opens the other bishop: a compact, solid setup.}`],
      ['Advance', `e4 c6 d4 d5
        e5 Bf5 {Develops the bishop before ...e6 closes it in.}
        Nf3 e6 {Supports d5 and opens the bishop on f8.}
        Be2 c5 {Strikes at White's centre, the standard break.}`],
      ['Exchange', `e4 c6 d4 d5
        exd5 cxd5 {Takes back with the c-pawn: a symmetrical, solid centre.}
        Bd3 Nc6 {Develops and hits d4.}
        c3 Nf6 {Develops.}
        Bf4 Bg4 {Develops actively and hits the queen.}
        Qb3 Qd7 {Defends b7 calmly.}`],
    ]),
  opening('scandinavian', 'Scandinavian Defence', 'b', 'B01',
    'Black challenges e4 on move one. The queen loses a little time after taking back on d5, but Black gets a simple, solid position.', [
      ['Main line 3...Qa5', `e4 d5 {Attacks e4 immediately.}
        exd5 Qxd5 {Takes back; the queen will have to move again.}
        Nc3 Qa5 {Steps to a5, out of reach but still active.}
        d4 Nf6 {Develops.}
        Nf3 c6 {Gives the queen a retreat and keeps White's pieces off b5 and d5.}
        Bc4 Bf5 {Develops outside the pawn chain.}
        Bd2 e6 {Solid: opens the dark-squared bishop.}`],
      ['Modern 3...Qd6', `e4 d5 exd5 Qxd5
        Nc3 Qd6 {On d6 the queen is harder to attack than on a5.}
        d4 Nf6 {Develops.}
        Nf3 a6 {Keeps White's knight and bishop off b5.}`],
    ]),
  opening('petrov', 'Petrov Defence', 'b', 'C42',
    'Black answers the attack on e5 by attacking e4. Very solid. Beware the early trap: taking on e4 too soon runs into Qe2.', [
      ['Classical 3.Nxe5', `e4 e5 {Takes a centre square.}
        Nf3 Nf6 {Counterattacks e4 instead of defending e5.}
        Nxe5 d6 {First kicks the knight: taking on e4 now would run into Qe2 and lose material.}
        Nf3 Nxe4 {Now the pawn can be taken safely.}
        d4 d5 {Supports the knight on e4.}
        Bd3 Nc6 {Develops.}
        O-O Be7 {Develops, ready to castle.}`],
      ['3.d4', `e4 e5 Nf3 Nf6
        d4 Nxe4 {Takes the centre pawn.}
        Bd3 d5 {Supports the knight.}
        Nxe5 Nd7 {Challenges the knight on e5.}
        Nxd7 Bxd7 {Recaptures and develops.}
        O-O Bd6 {Develops, ready to castle.}`],
    ]),
  opening('kings-indian', 'King\'s Indian Defence', 'b', 'E60',
    'Black lets White build a big centre, castles fast, then strikes back with ...e5 and often attacks on the kingside with ...f5.', [
      ['Classical', `d4 Nf6 {Develops and stops e4 for now.}
        c4 g6 {Prepares the fianchetto.}
        Nc3 Bg7 {The King's Indian bishop on the long diagonal.}
        e4 d6 {Stops e5 and prepares ...e5.}
        Nf3 O-O {Castles early.}
        Be2 e5 {Strikes at the centre.}
        O-O Nc6 {Develops and adds pressure on d4.}
        d5 Ne7 {Heads for the kingside to support ...f5.}`],
      ['Samisch', `d4 Nf6 c4 g6 Nc3 Bg7 e4 d6
        f3 O-O {Castles.}
        Be3 e5 {Strikes at the centre.}
        d5 Nh5 {Prepares ...f5.}
        Qd2 f5 {The typical King's Indian break against e4.}`],
    ]),
  opening('nimzo-indian', 'Nimzo-Indian Defence', 'b', 'E20',
    'Black pins the knight on c3 to fight for e4 with pieces. Black is often happy to give the bishop for the knight to double White\'s pawns.', [
      ['Rubinstein 4.e3', `d4 Nf6 {Develops and stops e4 for now.}
        c4 e6 {Keeps both ...d5 and ...Bb4 possible.}
        Nc3 Bb4 {The Nimzo pin: the knight on c3 no longer controls e4.}
        e3 O-O {Castles first.}
        Bd3 d5 {Takes a share of the centre.}
        Nf3 c5 {Strikes at d4.}
        O-O Nc6 {Develops and adds pressure on d4.}`],
      ['Classical 4.Qc2', `d4 Nf6 c4 e6 Nc3 Bb4
        Qc2 O-O {Castles.}
        a3 Bxc3+ {Gives the bishop: White gets the bishop pair but loses time.}
        Qxc3 b6 {Prepares ...Bb7 to fight for e4.}
        Bg5 Bb7 {The bishop controls e4 and the long diagonal.}
        f3 h6 {Asks the bishop where it is going.}
        Bh4 d5 {Hits the centre while White's king is still in the middle.}`],
    ]),
  opening('slav', 'Slav Defence', 'b', 'D10',
    'Black defends d5 with ...c6 and keeps the light-squared bishop free. Solid, with a good pawn structure.', [
      ['Main line', `d4 d5 {Meets d4 head-on.}
        c4 c6 {Defends d5 without shutting in the c8 bishop.}
        Nf3 Nf6 {Develops.}
        Nc3 dxc4 {Takes the pawn, planning ...Bf5.}
        a4 Bf5 {Develops outside the pawn chain.}
        e3 e6 {Opens the dark-squared bishop.}
        Bxc4 Bb4 {Pins the knight and prepares to castle.}
        O-O O-O {Castles.}`],
      ['Exchange', `d4 d5 c4 c6
        cxd5 cxd5 {A symmetrical and solid centre.}
        Nc3 Nf6 {Develops.}
        Bf4 Nc6 {Develops.}
        e3 Bf5 {Develops actively, just like White.}`],
    ]),
  opening('dutch', 'Dutch Defence', 'b', 'A80',
    'Black answers 1.d4 with ...f5 to control e4 and prepare a kingside attack. Ambitious; the diagonal towards Black\'s king is a little weak early on.', [
      ['Classical', `d4 f5 {Controls e4 and prepares kingside play.}
        g3 Nf6 {Develops and controls e4 again.}
        Bg2 e6 {Opens the bishop.}
        Nf3 Be7 {Develops, ready to castle.}
        O-O O-O {Castles.}
        c4 d6 {Prepares ...e5.}
        Nc3 Qe8 {The queen heads for h5 or g6 to join a kingside attack.}`],
      ['Leningrad', `d4 f5 g3 Nf6
        Bg2 g6 {The Leningrad: the bishop goes to g7.}
        Nf3 Bg7 {Fianchetto.}
        O-O O-O {Castles.}
        c4 d6 {Prepares ...e5.}
        Nc3 Qe8 {Supports ...e5.}`],
    ]),
  opening('grunfeld', 'Grunfeld Defence', 'b', 'D70',
    'Black lets White build a big centre, then attacks it with pieces and ...c5. The bishop on g7 is the key piece.', [
      ['Exchange', `d4 Nf6 {Develops and stops e4 for now.}
        c4 g6 {Prepares the fianchetto.}
        Nc3 d5 {The Grunfeld: strikes at the centre at once.}
        cxd5 Nxd5 {Recaptures.}
        e4 Nxc3 {Trades knights; White's big centre becomes a target.}
        bxc3 Bg7 {The bishop presses on c3 and d4.}
        Nf3 c5 {Attacks the centre from the side.}
        Be3 Qa5 {Adds pressure on c3.}
        Qd2 O-O {Castles.}`],
    ]),

  // ------------------------------------------------------------ traps (White first, then Black)
  // `proof` is what the line must achieve on the board: mate, a fork or skewer on the last move, or a
  // material gain of at least `gain` points once it is over. test/openings.test.js checks it.
  trap('scholars-mate', 'Scholar\'s Mate', 'w', 'C20', 'Checkmate',
    'The queen and bishop both hit f7, the square only the king defends. Good to know from both sides: it wins fast against careless play.',
    `e4 {Opens the queen and the bishop.} e5
     Qh5 {Attacks e5 and f7.} Nc6
     Bc4 {A second attacker on f7.} Nf6
     Qxf7# {Mate: the bishop protects the queen.}`),
  trap('legals-mate', 'Legal\'s Mate', 'w', 'C41', 'Checkmate',
    'White breaks a pin by giving up the queen, and the minor pieces mate. A classic lesson: a pin is only a pin if the piece behind matters most.',
    `e4 {Takes the centre.} e5
     Nf3 {Develops and attacks e5.} d6
     Bc4 {Aims at f7.} Bg4
     Nc3 {Develops.} g6
     Nxe5 {Breaks the pin and offers the queen.} Bxd1
     Bxf7+ {Check: the king must step forward.} Ke7
     Nd5# {Mate by three minor pieces.}`),
  trap('caro-kann-smother', 'Caro-Kann Smothered Mate', 'w', 'B15', 'Checkmate',
    'A natural-looking knight move by Black walks into a one-move mate: the e-pawn is pinned by the white queen, so it cannot take the knight.',
    `e4 {Takes the centre.} c6
     d4 {Builds the centre.} d5
     Nc3 {Develops and defends e4.} dxe4
     Nxe4 {Recaptures in the centre.} Nd7
     Qe2 {Lines the queen up on the e-file, behind the knight.} Ngf6
     Nd6# {Mate: the pawn on e7 is pinned and cannot take the knight.}`),
  trap('magnus-smith', 'Magnus Smith Trap', 'w', 'B58', 'Wins the queen',
    'In the Sicilian, Black takes back on e5 with the d-pawn and opens the d-file. A bishop check on f7 deflects the king, and the queen falls.',
    `e4 {Takes the centre.} c5
     Nf3 {Develops.} d6
     d4 {Opens the centre.} cxd4
     Nxd4 {Recaptures.} Nf6
     Nc3 {Develops and defends e4.} Nc6
     Bc4 {Aims at f7.} g6
     Nxc6 {Trades knights.} bxc6
     e5 {Attacks the knight and invites ...dxe5.} dxe5
     Bxf7+ {Deflects the king: the queen on d8 is now unprotected.} Kxf7
     Qxd8 {Wins the queen; the bishop on c8 blocks the rook from taking back.}`, { proof: 'material', gain: 4 }),
  trap('damiano-trap', 'Punishing the Damiano', 'w', 'C40', 'Wins a rook',
    'After 2...f6 the black king is weak. White gives a knight for two pawns and then collects the rook in the corner.',
    `e4 {Takes the centre.} e5
     Nf3 {Develops and attacks e5.} f6
     Nxe5 {Gives the knight to open the diagonal to Black's king.} fxe5
     Qh5+ {Check; ...Ke7 would walk into a big attack.} g6
     Qxe5+ {Check, forking the king and the rook on h8.} Qe7
     Qxh8 {Takes the rook: White is well ahead.}`, { proof: 'material', gain: 4 }),

  trap('fools-mate', 'Fool\'s Mate', 'b', 'A00', 'Checkmate',
    'The fastest mate in chess. Two weakening pawn moves open the diagonal to White\'s king.',
    `f3 e5 {Opens the diagonal for the queen.}
     g4 Qh4# {Mate: nothing can block or take the queen, and the king has no square.}`),
  trap('englund-trap', 'Englund Gambit Trap', 'b', 'A40', 'Checkmate',
    'Black offers a pawn with ...e5 against 1.d4. If White grabs material carelessly, the black queen mates on c1.',
    `d4 e5 {The Englund Gambit.}
     dxe5 Nc6 {Attacks e5.}
     Nf3 Qe7 {Adds pressure on e5 and sets the trap.}
     Bf4 Qb4+ {Checks and hits b2.}
     Bd2 Qxb2 {Takes the pawn and attacks the rook.}
     Bc3 Bb4 {Attacks the bishop that guards the queen's path.}
     Qd2 Bxc3 {Removes the defender.}
     Qxc3 Qc1# {Mate: White's queen left the first rank.}`),
  trap('blackburne-shilling', 'Blackburne Shilling Gambit', 'b', 'C50', 'Checkmate',
    'Black leaves e5 hanging with ...Nd4. If White greedily takes it and then f7, the black queen and knight mate.',
    `e4 e5 {Takes a centre square.}
     Nf3 Nc6 {Develops and defends e5.}
     Bc4 Nd4 {A trick: it leaves e5 hanging on purpose.}
     Nxe5 Qg5 {Attacks the knight and g2 at the same time.}
     Nxf7 Qxg2 {Takes g2 and attacks the rook.}
     Rf1 Qxe4+ {Check, winning the e-pawn.}
     Be2 Nf3# {Mate: the king is boxed in by its own pieces.}`),
  trap('stafford-trap', 'Stafford Gambit Trap', 'b', 'C42', 'Checkmate',
    'Black gives a pawn for quick development. If White pins the knight to win the queen, the black bishops mate the king in the centre.',
    `e4 e5 {Takes a centre square.}
     Nf3 Nf6 {Counterattacks e4.}
     Nxe5 Nc6 {The Stafford Gambit: offers a pawn for time.}
     Nxc6 dxc6 {Opens lines for the queen and the c8 bishop.}
     d3 Bc5 {Aims at f2.}
     Bg5 Nxe4 {Lets the queen go: the attack is worth more.}
     Bxd8 Bxf2+ {Check: the king has to come forward.}
     Ke2 Bg4# {Mate: the two bishops and the knight cover every square.}`),
  trap('budapest-trap', 'Budapest Gambit Trap', 'b', 'A52', 'Checkmate',
    'The black queen lines up on the e-file against the king. If White takes the bishop, a knight jumps to d3 with mate: the e2 pawn is pinned.',
    `d4 Nf6 {Develops and stops e4 for now.}
     c4 e5 {The Budapest Gambit: a pawn for fast piece play.}
     dxe5 Ng4 {Attacks the pawn on e5.}
     Bf4 Nc6 {A second attacker on e5.}
     Nf3 Bb4+ {Check: develops with tempo.}
     Nbd2 Qe7 {Lines the queen up on the e-file.}
     a3 Ngxe5 {Takes the pawn and offers the bishop.}
     axb4 Nd3# {Mate: the pawn on e2 is pinned by the queen, and every square is covered.}`),
  trap('siberian-trap', 'Siberian Trap', 'b', 'B21', 'Checkmate',
    'Against the Smith-Morra Gambit. A careless h3 lets a knight jump in and deflect the only defender of h2.',
    `e4 c5 {The Sicilian.}
     d4 cxd4 {Takes the pawn.}
     c3 dxc3 {Accepts the Smith-Morra Gambit.}
     Nxc3 Nc6 {Develops.}
     Nf3 e6 {Opens the bishop and keeps the centre solid.}
     Bc4 Qc7 {The queen eyes h2 along the long diagonal.}
     O-O Nf6 {Develops.}
     Qe2 Ng4 {Joins the queen against h2.}
     h3 Nd4 {Attacks the queen and lures the knight away from f3.}
     Nxd4 Qh2# {Mate: the knight on f3 no longer defends h2.}`),
  trap('elephant-trap', 'Elephant Trap', 'b', 'D51', 'Wins a piece',
    'In the Queen\'s Gambit Declined, White thinks the knight on f6 is pinned and grabs d5. It is not a real pin, and Black wins a piece.',
    `d4 d5 {Meets d4 head-on.}
     c4 e6 {Declines the gambit.}
     Nc3 Nf6 {Develops.}
     Bg5 Nbd7 {Develops and sets the trap.}
     cxd5 exd5 {Recaptures.}
     Nxd5 Nxd5 {Takes the knight and gives the queen.}
     Bxd8 Bb4+ {Check: the queen has to block.}
     Qd2 Bxd2+ {Takes the queen back.}
     Kxd2 Kxd8 {Takes the bishop: Black is a piece up for a pawn.}`, { proof: 'material', gain: 2 }),
  trap('lasker-trap', 'Lasker Trap', 'b', 'D08', 'Wins the queen',
    'In the Albin Countergambit, White grabs a bishop and Black\'s pawn runs to the first rank, promoting to a knight with check.',
    `d4 d5 {Meets d4 head-on.}
     c4 e5 {The Albin Countergambit.}
     dxe5 d4 {Gains space and cramps White.}
     e3 Bb4+ {Checks before taking on e3.}
     Bd2 dxe3 {Attacks f2 and offers the bishop.}
     Bxb4 exf2+ {Check: the pawn keeps running.}
     Ke2 fxg1=N+ {Promotes to a knight with check.}
     Rxg1 Bg4+ {A skewer: the king moves and the queen on d1 falls.}`, { proof: 'skewer' }),
  trap('mortimer-trap', 'Mortimer Trap', 'b', 'C65', 'Wins a knight',
    'Against the Ruy Lopez. Black retreats a knight to invite Nxe5, then a queen check forks the king and the knight.',
    `e4 e5 {Takes a centre square.}
     Nf3 Nc6 {Develops and defends e5.}
     Bb5 Nf6 {The Berlin: counterattacks e4.}
     d3 Ne7 {Leaves e5 unprotected on purpose.}
     Nxe5 c6 {Chases the bishop first.}
     Ba4 Qa5+ {A fork: check, and the knight on e5 falls.}`, { proof: 'fork' }),
];

export const OPENING_LINES = OPENINGS.flatMap((o) => o.lines.map((line) => ({ ...line, opening: o })));
export const findLine = (id) => OPENING_LINES.find((l) => l.id === id);
/** Indices of the moves the learner plays in a line (White plays the even plies). */
export const learnerPlies = (line, side) => line.moves.map((_, i) => i).filter((i) => (i % 2 === 0) === (side === 'w'));
