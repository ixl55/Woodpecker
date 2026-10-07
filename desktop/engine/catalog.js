// The puzzles of both books: read-only, loaded once when the app starts.
import fs from 'node:fs';

import { Chess } from '../renderer/vendor/chess.js';

export function loadCatalog(file) {
  const puzzles = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of puzzles) {
    p.themeList = (p.themes || []);
    p.themeSet = new Set(p.themeList);
    p.mates = p.san.length > 0 && p.san[p.san.length - 1].endsWith('#');
    p.solverMoves = Math.ceil(p.moves.length / 2);
  }
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  return { puzzles, byId };
}

// ---------------------------------------------------------------- judging a move (Sprint)
function boardAt(fen, moves, ply) {
  const board = new Chess(fen);
  for (const uci of moves.slice(0, ply)) board.move(toMove(uci));
  return board;
}

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

export function fenAt(fen, moves, ply) {
  return boardAt(fen, moves, ply).fen();
}

/** Judge the solver's move at `ply`. Any other move that mates is accepted too. */
export function checkMove(fen, moves, ply, uci) {
  const board = boardAt(fen, moves, ply);
  const expected = moves[ply];
  let played;
  try {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('not a move');
    played = board.move(toMove(uci));
  } catch {
    return { result: 'wrong', expected };
  }
  const mate = board.isCheckmate();
  if (uci !== expected && !mate) return { result: 'wrong', expected, san: played.san };
  if (mate || ply + 1 >= moves.length) return { result: 'solved', san: played.san };
  const reply = moves[ply + 1];
  const replySan = board.move(toMove(reply)).san;
  return { result: 'correct', san: played.san, reply, reply_san: replySan, next_ply: ply + 2 };
}
