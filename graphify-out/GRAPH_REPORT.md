# Graph Report - chess  (2026-09-27)

## Corpus Check
- 51 files · ~359,534 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1891 nodes · 4838 edges · 88 communities (68 shown, 20 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 244 edges (avg confidence: 0.9)
- Token cost: 164,551 input · 0 output

## Community Hubs (Navigation)
- Desktop Chessground Vendor
- Web Chessground Vendor
- Learn Practice Drills
- Web Frontend App
- Desktop Renderer App
- Puzzle Explanations
- FastAPI Server Entry
- Web chess.js Vendor
- Desktop IPC API and Icons
- Database and Catalogue
- Desktop chess.js Vendor
- Book 2 Extraction
- Session and Users
- Tactical Theme Detectors
- chess.js Attack Queries
- Sprint Mode Server
- Social and Challenges UI
- Challenge Engine
- Achievements and Progress
- API Tests and Time
- Desktop Engine Handlers
- Puzzle Routes
- Auth and Accounts
- Opening Line Player
- Web Charts
- Desktop Store and Catalogue
- PGN Parser (desktop)
- Desktop Engine Config
- Security Tests
- PGN Parser (web)
- Desktop Motion and Judge
- Friends
- chess.js Comments and FEN
- Web Motion
- Desktop Solve Panel
- Custom Theme and Profile
- Desktop Solver
- Web API and Challenge
- Theme Pipeline Tests
- PDF Diagram Extraction
- Web Solver
- chess.js Move Core
- Board Image Reader
- Desktop Statistics
- Piece Set CSS Builder
- chess.js Attack Core
- Solution Text Extraction
- Realtime Hub
- Opening Cards and SAN
- Test Fixtures
- Desktop Package Manifest
- NSIS Installer Config
- Data Pipeline Concepts
- chess.js Load and Reset
- Desktop Data Prep
- Rate Limiter
- Electron Build Config
- Remote Solver
- chess.js Undo and Moves
- Game Modes Concepts
- Deployment Config
- Backend Architecture Concepts
- Openings Data
- Brand and Logo
- chess.js SAN Helpers
- Desktop Page Shell and Themes
- chess.js Move Flags
- Extraction Preview Tool
- Web Icons
- Desktop Dev Dependencies
- Desktop npm Scripts
- Learn and Openings Concepts
- Books and Authors
- Desktop Logo Images
- PGN Syntax Errors
- Rewards and Appearance Concepts
- Windows Build Target
- Electron Preload Bridge
- Stray ref
- argon2 dependency
- Python dev dependencies
- itsdangerous dependency
- python-chess dependency
- SQLAlchemy dependency
- pytest parametrize

## God Nodes (most connected - your core abstractions)
1. `Chess` - 86 edges
2. `Chess` - 70 edges
3. `User` - 58 edges
4. `esc()` - 47 edges
5. `utcnow()` - 43 edges
6. `Player` - 40 edges
7. `createApi()` - 39 edges
8. `Challenge` - 36 edges
9. `peg$parse()` - 32 edges
10. `peg$parse()` - 32 edges

## Surprising Connections (you probably didn't know these)
- `Apple Touch Icon (180px Woodpecker Mark)` --semantically_similar_to--> `Woodpecker Logo (Brand Mark)`  [INFERRED] [semantically similar]
  static/img/apple-touch-icon.png → logo.png
- `In-site Logo 256px (Woodpecker head, red crest, navy W body)` --semantically_similar_to--> `Woodpecker Logo (Brand Mark)`  [INFERRED] [semantically similar]
  static/img/logo-256.png → logo.png
- `Favicon 32px (Woodpecker Mark)` --semantically_similar_to--> `Woodpecker Logo (Brand Mark)`  [INFERRED] [semantically similar]
  static/img/logo-32.png → logo.png
- `Favicon 64px (Woodpecker Mark)` --semantically_similar_to--> `Woodpecker Logo (Brand Mark)`  [INFERRED] [semantically similar]
  static/img/logo-64.png → logo.png
- `Renderer Content-Security-Policy (connect-src none)` --semantically_similar_to--> `Security Module (app/security.py)`  [INFERRED] [semantically similar]
  desktop/renderer/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Server-Authoritative Competitive Modes** — readme_friends_challenges, readme_live_duel [EXTRACTED 1.00]
- **Production Security Configuration** — render_https_only, render_secret_key, render_proxy_hops [INFERRED 0.85]
- **Puzzle Ingestion Pipeline (extract, validate, correct, store)** — readme_overrides_json, readme_book_errata, readme_puzzles_json [INFERRED 0.85]
- **Server-authoritative competitive modes** — readme_sprint, readme_live_duel, readme_friends_challenges, readme_challenge_engine, readme_server_authoritative_validation [EXTRACTED 1.00]
- **Book extraction and verification pipeline** — readme_pdf_extraction_pipeline, readme_book2_extraction, readme_board_image_template_matching, readme_chess_merida_font_parsing, readme_python_chess, readme_overrides_json, readme_puzzles_json [EXTRACTED 1.00]
- **In-memory state requiring single-process deployment** — readme_realtime_websocket, readme_security_module, readme_puzzle_catalog, readme_single_process_constraint [INFERRED 0.85]
- **Logo multi-resolution icon set** — desktop_renderer_img_logo_32, desktop_renderer_img_logo_64, desktop_renderer_img_logo_256 [INFERRED 0.95]

## Communities (88 total, 20 thin omitted)

### Community 0 - "Desktop Chessground Vendor"
Cohesion: 0.06
Nodes (85): ae(), ao(), ar(), b(), Be(), bo(), br(), C() (+77 more)

### Community 1 - "Web Chessground Vendor"
Cohesion: 0.06
Nodes (85): ae(), ao(), ar(), b(), Be(), bo(), br(), C() (+77 more)

### Community 2 - "Learn Practice Drills"
Cohesion: 0.07
Nodes (39): ALL_SQUARES, DRILLS, GEN, legal(), light(), makeRound(), makeRounds(), near() (+31 more)

### Community 3 - "Web Frontend App"
Cohesion: 0.07
Nodes (68): appearance, applyAppearance(), applyBoard(), applyPieces(), badgeHtml(), BOARD_COLORS, boards, celebrate() (+60 more)

### Community 4 - "Desktop Renderer App"
Cohesion: 0.09
Nodes (62): appearance, applyAppearance(), applyBoard(), applyPieces(), badgeHtml(), BOARD_COLORS, BOARD_PAGES(), boards (+54 more)

### Community 5 - "Puzzle Explanations"
Cohesion: 0.08
Nodes (44): _at(), explain(), explain_line(), _join(), _Line, main(), _mate_threat(), _material_words() (+36 more)

### Community 6 - "FastAPI Server Entry"
Cohesion: 0.05
Nodes (39): Forget the cached catalogue (after the puzzles table has been reseeded)., reset(), healthz(), index(), lifespan(), get, A fingerprint of every static file. It changes whenever any of them does, so…, StaticFiles with an explicit Cache-Control: a year for the versioned copies,… (+31 more)

### Community 7 - "Web chess.js Vendor"
Cohesion: 0.06
Nodes (40): ATTACKS, BITS, CASTLING_KEYS, classEscape(), describeExpectation(), describeExpected(), describeFound(), EP_KEYS (+32 more)

### Community 8 - "Desktop IPC API and Icons"
Cohesion: 0.09
Nodes (36): api, ApiError, request(), paintThemeButton(), maxScore(), icons, logo(), paths (+28 more)

### Community 9 - "Database and Catalogue"
Cohesion: 0.11
Nodes (30): The puzzle catalogue is fixed while the server runs (app.seed loads it at…, Base, get_db(), Attempt, ChallengeResult, Friendship, Profile, Outcome of one puzzle inside a challenge, for the side-by-side comparison. (+22 more)

### Community 10 - "Desktop chess.js Vendor"
Cohesion: 0.06
Nodes (38): ATTACKS, BITS, CASTLING_KEYS, classEscape(), describeExpectation(), describeExpected(), describeFound(), EP_KEYS (+30 more)

### Community 11 - "Book 2 Extraction"
Cohesion: 0.08
Nodes (34): Positional themes named in the opening of the book's explanation. Only a…, text_themes(), csv, build_puzzle(), difficulty(), extract_all(), _follows(), _items() (+26 more)

### Community 12 - "Session and Users"
Cohesion: 0.19
Nodes (34): current_user(), Request, Session, Session user for a WebSocket (SessionMiddleware fills websocket.session too)., _session_user(), ws_user(), player_for(), public_user() (+26 more)

### Community 13 - "Tactical Theme Detectors"
Cohesion: 0.12
Nodes (34): _balance(), _capture(), _exchange(), _fork_targets(), _gains(), _hanging(), _mate_patterns(), _material() (+26 more)

### Community 15 - "Sprint Mode Server"
Cohesion: 0.15
Nodes (29): Puzzle, A solo race against the clock: as many puzzles as possible in 3 or 5 minutes, 3…, SprintRun, best_for(), current(), end(), finish(), _iso() (+21 more)

### Community 16 - "Social and Challenges UI"
Cohesion: 0.21
Nodes (33): openSocket(), stagger(), challengeRow(), hearts(), LEVEL, LEVEL_SHORT, mine(), modeIcon() (+25 more)

### Community 17 - "Challenge Engine"
Cohesion: 0.16
Nodes (31): _advance(), board_at(), ChallengeError, check_move(), current_puzzle(), decide(), finalize(), _iso() (+23 more)

### Community 18 - "Achievements and Progress"
Cohesion: 0.11
Nodes (25): Achievement, compute(), current_streak(), longest_streak(), Session, rank_for(), Derived progress for a user: rank, streaks, records and achievements.…, AppearanceIn (+17 more)

### Community 19 - "API Tests and Time"
Cohesion: 0.12
Nodes (18): datetime, Naive UTC: SQLite drops tz info, so keep every stored timestamp naive., utcnow(), datetime, test_failed_puzzle_enters_review_and_climbs_boxes(), test_races_use_book_one_only(), edit(), miss_current() (+10 more)

### Community 20 - "Desktop Engine Handlers"
Cohesion: 0.16
Nodes (29): accuracy(), ApiError, createApi(), attempt(), drillDone(), earning(), finish(), getPuzzle() (+21 more)

### Community 21 - "Puzzle Routes"
Cohesion: 0.11
Nodes (26): entries(), Entry, Session, Every puzzle in book order, with what the pages need to know about it., get_puzzle(), has_theme(), last_results(), list_puzzles() (+18 more)

### Community 22 - "Auth and Accounts"
Cohesion: 0.16
Nodes (27): hash_password(), Fresh session for `user` (clearing first prevents session fixation)., start_session(), verify_password(), AccountDeletion, change_password(), Credentials, delete_account() (+19 more)

### Community 23 - "Opening Line Player"
Cohesion: 0.20
Nodes (4): colorName(), LinePlayer, renderOpening(), renderOpeningReview()

### Community 24 - "Web Charts"
Cohesion: 0.12
Nodes (26): accuracyLine(), attachTips(), axis(), columns(), dailyBars(), heatmap(), niceMax(), sparkline() (+18 more)

### Community 25 - "Desktop Store and Catalogue"
Cohesion: 0.13
Nodes (18): boardAt(), checkMove(), fenAt(), loadCatalog(), toMove(), DEFAULT_PROFILE, fresh(), Store (+10 more)

### Community 26 - "PGN Parser (desktop)"
Cohesion: 0.19
Nodes (23): lineToTree(), peg$parse(), peg$computeLocation(), peg$computePosDetails(), peg$fail(), peg$parse_(), peg$parsebraceComment(), peg$parsecomment() (+15 more)

### Community 27 - "Desktop Engine Config"
Cohesion: 0.13
Nodes (24): BOX_INTERVAL_DAYS, LESSON_IDS, LEVELS, LINE_IDS, LINE_REVIEW_DAYS, PROFILE_CHOICES, SPRINT_PLAN, TIME_BUCKETS (+16 more)

### Community 28 - "Security Tests"
Cohesion: 0.10
Nodes (13): fastapi_testclient, parametrize, new_name(), Move the clock forward for the app and the cookie signer alike., test_a_visit_renews_the_thirty_days(), test_more_than_thirty_days_away_means_signing_in_again(), test_password_rules_beyond_character_classes(), test_sign_in_cookie_lasts_thirty_days() (+5 more)

### Community 29 - "PGN Parser (web)"
Cohesion: 0.20
Nodes (22): peg$parse(), peg$computeLocation(), peg$computePosDetails(), peg$fail(), peg$parse_(), peg$parsebraceComment(), peg$parsecomment(), peg$parsegameTerminationMarker() (+14 more)

### Community 30 - "Desktop Motion and Judge"
Cohesion: 0.23
Nodes (22): mountSolver(), clockOffset(), burst(), countUp(), pingSquare(), reduced(), shake(), transition() (+14 more)

### Community 31 - "Friends"
Cohesion: 0.19
Nodes (21): accept_request(), are_friends(), cancel_request(), decline_request(), FriendRequestIn, friendship_page(), _incoming(), list_friends() (+13 more)

### Community 33 - "Web Motion"
Cohesion: 0.23
Nodes (21): clockOffset(), burst(), countUp(), fillRings(), pingSquare(), reduced(), shake(), transition() (+13 more)

### Community 34 - "Desktop Solve Panel"
Cohesion: 0.13
Nodes (20): coordsHtml(), drawPanel(), explainDialog(), levelTag(), lineHtml(), pips(), scoresheet(), AVATAR (+12 more)

### Community 35 - "Custom Theme and Profile"
Cohesion: 0.20
Nodes (17): profileOut(), saveProfile(), bestText(), contrast(), CUSTOM_VARS, customTheme(), DEFAULT_CUSTOM, hex() (+9 more)

### Community 37 - "Web API and Challenge"
Cohesion: 0.15
Nodes (6): api, ApiError, request(), colorName(), RemoteSolver, static_vendor_chessground_chessground

### Community 38 - "Theme Pipeline Tests"
Cohesion: 0.15
Nodes (15): detect_themes(), exercise_themes(), main(), Tactical themes of a solution line., Book 2: the positional themes of the key move (read from the book's…, Store book 1's tactical themes in data/puzzles.json (book 2's are written by…, parametrize, test_book2_tactics_come_from_the_whole_line() (+7 more)

### Community 39 - "PDF Diagram Extraction"
Cohesion: 0.15
Nodes (17): difficulty_for_page(), plain(), Symbol fonts put glyphs in the U+F0xx private range; map them back to ASCII., extract_all(), extract_page(), _grid(), rank_to_fen(), Extract the exercise diagrams (as FEN piece placement) from the book. Diagrams… (+9 more)

### Community 42 - "Board Image Reader"
Cohesion: 0.17
Nodes (13): Document, BoardReader, dehatch(), _grid(), Read the board images of The Woodpecker Method 2 into FEN placements. Every…, Drop pixels of one-pixel diagonal lines (and stray single pixels) with white on…, (piece or '.', distance to the best template, lead over the runner-up)., FEN placement of the diagram and the smallest lead of any square (low =… (+5 more)

### Community 43 - "Desktop Statistics"
Cohesion: 0.24
Nodes (16): dailyCard(), deltaChip(), onLeave(), relativeDue(), renderStats(), accuracyLine(), attachTips(), axis() (+8 more)

### Community 44 - "Piece Set CSS Builder"
Cohesion: 0.16
Nodes (7): bauhaus_svg(), main(), material_rules(), Build static/css/pieces.css: the cburnett pieces plus the extra piece sets.…, selectors(), uri(), re

### Community 46 - "Solution Text Extraction"
Cohesion: 0.19
Nodes (11): parse_title(), Hamppe – Steinitz, Vienna 1860' -> players / event / year. Also copes with the…, extract_all(), _is_bold(), Extract the main solution line of every exercise. Solution text mixes the main…, Yield ('header', id, title) and ('text', text, bold) / ('mark', bold) items in…, Chunks of contiguous bold text -> [{'num', 'black', 'san'}]; a new chunk may…, _stream() (+3 more)

### Community 47 - "Realtime Hub"
Cohesion: 0.18
Nodes (7): Hub, run(), run(), datetime, WebSocket, Finalise a live duel exactly when its clock runs out, then notify both players., If a duel player stays disconnected for GRACE_S seconds, they forfeit.

### Community 48 - "Opening Cards and SAN"
Cohesion: 0.22
Nodes (6): cardFen(), addMove(), algebraic(), file(), getDisambiguator(), rank()

### Community 49 - "Test Fixtures"
Cohesion: 0.20
Nodes (12): fixture, pytest, sys, tempfile, client(), fresh_limits(), friends(), make_player() (+4 more)

### Community 50 - "Desktop Package Manifest"
Cohesion: 0.15
Nodes (12): author, description, main, name, private, productName, type, version (+4 more)

### Community 51 - "NSIS Installer Config"
Cohesion: 0.15
Nodes (13): nsis, allowToChangeInstallationDirectory, artifactName, createDesktopShortcut, createStartMenuShortcut, deleteAppDataOnUninstall, installerHeader, installerSidebar (+5 more)

### Community 52 - "Data Pipeline Concepts"
Cohesion: 0.19
Nodes (13): Board Image Template Matching (extract/board_image.py), Book 2 Extraction (extract/book2.py), Book Errata Corrections, Chess Merida Font Text Parsing, Explain the Idea (app/explain.py), data/explanations.json, data/overrides.json (manual errata), PDF Puzzle Extraction Pipeline (extract/) (+5 more)

### Community 53 - "chess.js Load and Reset"
Cohesion: 0.21
Nodes (4): inferPieceType(), isDigit(), strippedSan(), validateFen()

### Community 54 - "Desktop Data Prep"
Cohesion: 0.18
Nodes (10): compact(), desktop, explanations, FIELDS, fontDir, FONTS, here, project (+2 more)

### Community 55 - "Rate Limiter"
Cohesion: 0.22
Nodes (5): RateLimiter, Sliding-window counters keyed by any string (IP, username, user id...)., Seconds to wait before `key` may act again (0 = allowed). Does not record…, Record one action if allowed; returns seconds to wait when the limit is already…, deque

### Community 56 - "Electron Build Config"
Cohesion: 0.18
Nodes (11): build, appId, asar, compression, copyright, directories, electronLanguages, files (+3 more)

### Community 59 - "Game Modes Concepts"
Cohesion: 0.22
Nodes (11): Account Deletion (POST /api/auth/delete-account), Challenge Engine (app/challenge_engine.py), Friends and Group Challenges (app/routers/friends.py), Live Duel, Server-Authoritative Move Validation (anti-cheat), Sprint Mode (app/routers/sprint.py), Statistics Dashboard, Live Banner (aria-live status) (+3 more)

### Community 60 - "Deployment Config"
Cohesion: 0.20
Nodes (11): DATABASE_URL env (Neon connection string), /healthz Health Check, HTTPS_ONLY=1 env, PROXY_HOPS=1 env, SECRET_KEY env (generated), uvicorn app.main:app start command with proxy headers, woodpecker-puzzles Render Web Service, fastapi>=0.116 (+3 more)

### Community 61 - "Backend Architecture Concepts"
Cohesion: 0.24
Nodes (10): Renderer Content-Security-Policy (connect-src none), Argon2 Password Hashing, Auto Column Migration (ensure_columns in app/seed.py), FastAPI + SQLAlchemy Backend (app/), In-Memory Puzzle Catalog (app/catalog.py), Realtime WebSocket Hub (app/realtime.py), Render + Neon Free Deployment, Security Module (app/security.py) (+2 more)

### Community 62 - "Openings Data"
Cohesion: 0.31
Nodes (7): learnerPlies(), opening(), OPENING_LINES, OPENINGS, parse(), trap(), ref_node_assert

### Community 65 - "Brand and Logo"
Cohesion: 0.27
Nodes (10): Brand Palette (Red / Navy / White), The Woodpecker Method (book), W Monogram, Woodpecker Bird Mascot, Woodpecker Logo (Brand Mark), Woodpecker Chess-Puzzle Website, Apple Touch Icon (180px Woodpecker Mark), In-site Logo 256px (Woodpecker head, red crest, navy W body) (+2 more)

### Community 66 - "chess.js SAN Helpers"
Cohesion: 0.29
Nodes (5): addMove(), algebraic(), file(), getDisambiguator(), rank()

### Community 67 - "Desktop Page Shell and Themes"
Cohesion: 0.28
Nodes (9): Desktop Renderer index.html, Pre-paint Boot Script (js/boot.js), Theme Toggle Button, Main View Container (#view), chessground, Custom Theme Mode (custom-theme.js), Motion System (static/js/motion.js), No-build Static Frontend (static/) (+1 more)

### Community 69 - "Extraction Preview Tool"
Cohesion: 0.29
Nodes (5): base64, chess_svg, Side-by-side HTML (book diagram vs. extracted FEN) for a random sample of…, json, random

### Community 70 - "Web Icons"
Cohesion: 0.33
Nodes (6): icons, logo(), paths, ring(), svg(), themeToggleSvg()

### Community 72 - "Desktop Dev Dependencies"
Cohesion: 0.33
Nodes (6): devDependencies, electron, electron-builder, @fontsource-variable/bricolage-grotesque, @fontsource-variable/figtree, @fontsource-variable/jetbrains-mono

### Community 73 - "Desktop npm Scripts"
Cohesion: 0.40
Nodes (5): scripts, dist, prepare-data, start, test

### Community 74 - "Learn and Openings Concepts"
Cohesion: 0.50
Nodes (5): Topbar Navigation (Train, Learn, Review, Sprint, Puzzles, Statistics), chess.js, Desktop Learn Page (lessons.js, learn-rules.js, drills.js), Leitner Box Spaced Repetition, Openings Trainer (openings.js, openings-ui.js)

### Community 75 - "Books and Authors"
Cohesion: 0.40
Nodes (5): Axel Smith, Hans Tikkanen, The Woodpecker Method (book), The Woodpecker Method 2 (book), Woodpecker Chess Puzzle Site

### Community 76 - "Desktop Logo Images"
Cohesion: 0.83
Nodes (4): App Logo 256px (Woodpecker Mascot), App Logo 32px (Woodpecker Mascot), App Logo 64px (Woodpecker Mascot), Woodpecker Brand Mark

### Community 77 - "PGN Syntax Errors"
Cohesion: 0.50
Nodes (3): peg$padEnd(), peg$buildStructuredError(), peg$SyntaxError()

### Community 78 - "Rewards and Appearance Concepts"
Cohesion: 0.50
Nodes (4): Achievements and Cosmetic Rewards (REWARDS in app/progress.py), Desktop Badges (desktop/engine/progress.js), Piece Sets (pieces.css generated by extract/piece_css.py), Pre-Paint Appearance Script (localStorage appearance/board/pieces)

### Community 79 - "Windows Build Target"
Cohesion: 0.67
Nodes (3): win, icon, target

## Ambiguous Edges - Review These
- `Live Banner (aria-live status)` → `Live Duel`  [AMBIGUOUS]
  static/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **177 isolated node(s):** `NOUNS`, `PIECE_NAMES`, `REWARD_KINDS`, `LENGTHS`, `REASON` (+172 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 475 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Live Banner (aria-live status)` and `Live Duel`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Chess` connect `chess.js Attack Queries` to `chess.js SAN Helpers`, `chess.js Move Flags`, `Web API and Challenge`, `Web chess.js Vendor`, `chess.js Move Core`, `chess.js Load and Reset`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `Chess` connect `chess.js Comments and FEN` to `chess.js Game State`, `Desktop Solve Panel`, `Learn Practice Drills`, `Desktop Renderer App`, `Desktop Solver`, `Desktop IPC API and Icons`, `Desktop chess.js Vendor`, `chess.js Attack Core`, `Opening Cards and SAN`, `Opening Line Player`, `Openings Data`, `Desktop Store and Catalogue`, `chess.js Undo and Moves`, `chess.js Headers`, `Desktop Motion and Judge`, `Remote Solver`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `NOTE: Some positions and moves may be ambiguous when using the permissive` connect `Web chess.js Vendor` to `Desktop chess.js Vendor`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 47 inferred relationships involving `User` (e.g. with `current_user()` and `_session_user()`) actually correct?**
  _`User` has 47 INFERRED edges - model-reasoned connections that need verification._
- **What connects `NOUNS`, `PIECE_NAMES`, `REWARD_KINDS` to the rest of the system?**
  _177 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Desktop Chessground Vendor` be split into smaller, more focused modules?**
  _Cohesion score 0.06165099268547544 - nodes in this community are weakly interconnected._