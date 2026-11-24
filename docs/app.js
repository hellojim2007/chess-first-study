(() => {
  "use strict";
  const lessons = window.CHESS_LESSONS;
  const $ = id => document.getElementById(id);
  const board = $("board");
  const controls = $("controls");
  const promotion = $("promotion");
  const storageKey = "chess-study-v1";
  const glyphs = {k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎"};
  const names = {k: "王", q: "后", r: "车", b: "象", n: "马", p: "兵"};
  const values = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};
  const typeLabels = {move: "动手走棋", quiz: "局面判断", study: "逐手复盘", lab: "自由演练"};
  const total = lessons.reduce((count, item) => count + item.exercises.length, 0);
  const squares = new Map();
  const readState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return {done: Array.isArray(saved.done) ? saved.done : [], slots: saved.slots || {}, last: saved.last};
    } catch {
      return {done: [], slots: {}, last: null};
    }
  };
  const saved = readState();
  const done = new Set(saved.done.filter(key => lessons.some(item => item.exercises.some((_, i) => key === item.id + "/" + i))));
  let lessonIndex = 0;
  let exerciseIndex = 0;
  let lesson, exercise, base, frames, frameIndex, selected, legalTargets, marked, currentChoice, variationIndex, engaged;
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({done: [...done], slots: saved.slots, last: lesson.id}));
    } catch {
      // Interaction still works if the browser denies storage.
    }
  };

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }
  function button(label, action, className = "button") {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function progress() {
    $("progress").max = total;
    $("progress").value = done.size;
    $("progress-label").textContent = done.size + " / " + total;
  }
  function complete() {
    done.add(lesson.id + "/" + exerciseIndex);
    save();
    progress();
    updateExerciseNav();
  }
  function makeBoard() {
    const files = "abcdefgh";
    for (let rank = 8; rank > 0; rank--) {
      for (let column = 0; column < files.length; column++) {
        const file = files[column];
        const square = file + rank;
        const node = button("", () => selectSquare(square), "square");
        node.dataset.square = square;
        node.classList.toggle("dark", (rank + column) % 2 !== 0);
        node.tabIndex = square === "a8" ? 0 : -1;
        node.addEventListener("focus", () => {
          for (const cell of squares.values()) cell.node.tabIndex = cell.node === node ? 0 : -1;
        });
        node.addEventListener("keydown", event => {
          const deltas = {ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]};
          const delta = deltas[event.key];
          if (!delta) return;
          event.preventDefault();
          const to = files[column + delta[0]] + (rank + delta[1]);
          squares.get(to)?.node.focus();
        });
        const piece = el("span", "piece");
        piece.setAttribute("aria-hidden", "true");
        node.append(piece);
        if (column === 0) {
          const coord = el("span", "coord rank", String(rank));
          coord.setAttribute("aria-hidden", "true");
          node.append(coord);
        }
        if (rank === 1) {
          const coord = el("span", "coord file", file);
          coord.setAttribute("aria-hidden", "true");
          node.append(coord);
        }
        squares.set(square, {node, piece});
        board.append(node);
      }
    }
  }
  function makeGame() {
    const game = exercise.fen ? new Chess(exercise.fen) : new Chess();
    for (const san of exercise.setup || []) game.move(san);
    return game;
  }
  function applyMove(game, spec) {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(spec)) {
      return game.move({from: spec.slice(0, 2), to: spec.slice(2, 4), promotion: spec[4]});
    }
    return game.move(spec);
  }
  function makeFrames(sequence = []) {
    const game = makeGame();
    const built = [{game: makeGame(), move: null}];
    for (const spec of sequence) {
      const move = applyMove(game, spec);
      built.push({game: new Chess(game.fen()), move});
    }
    built[built.length - 1].game = game;
    return built;
  }
  function renderBoard() {
    const {game, move} = frames[frameIndex];
    for (const [square, {node, piece}] of squares) {
      const item = game.get(square);
      piece.textContent = item ? glyphs[item.type] : "";
      piece.classList.toggle("white", item?.color === "w");
      node.setAttribute("aria-label", square + (item ? " " + (item.color === "w" ? "白" : "黑") + names[item.type] : " 空格"));
      node.classList.toggle("occupied", Boolean(item));
      node.classList.toggle("selected", square === selected);
      node.classList.toggle("legal", legalTargets.includes(square));
      node.classList.toggle("last", move?.from === square || move?.to === square);
      node.classList.toggle("marked", marked.includes(square));
    }
    const side = game.turn() === "w" ? "白方" : "黑方";
    let turn = side + "走";
    if (game.isCheckmate()) turn = side + "被将死";
    else if (game.isStalemate()) turn = "逼和";
    else if (game.isInsufficientMaterial()) turn = "子力不足，和棋";
    else if (game.isCheck()) turn = side + "被将军";
    const dot = el("span", "turn-dot" + (game.turn() === "b" ? " black" : ""));
    dot.setAttribute("aria-hidden", "true");
    $("turn").replaceChildren(dot, el("span", "", turn));
    $("fen").textContent = game.fen();
  }
  function renderTurnScore() {
    const game = frames[frameIndex].game;
    const scores = {w: 0, b: 0};
    for (const piece of game.board().flat().filter(Boolean)) scores[piece.color] += values[piece.type];
    const diff = scores.w - scores.b;
    const readout = el("div", "readout");
    readout.append(el("span", "", "子力估算（不含王）"), el("strong", "", "白 " + scores.w + " · 黑 " + scores.b),
      el("strong", "", "白方差值 " + (diff > 0 ? "+" : "") + diff));
    return readout;
  }
  function showFeedback(title, text, kind = "") {
    const target = $("feedback");
    target.hidden = false;
    target.className = "feedback" + (kind ? " " + kind : "");
    target.replaceChildren(el("strong", "", title), el("p", "", text));
  }
  function showPromotion(from, to) {
    promotion.replaceChildren(el("span", "", "升变为"));
    for (const type of ["q", "r", "b", "n"]) {
      promotion.append(button(names[type], () => attempt(from + to + type)));
    }
    promotion.hidden = false;
    promotion.querySelector("button").focus();
  }
  function clearSelection() {
    selected = null;
    legalTargets = [];
    promotion.hidden = true;
  }
  function selectSquare(square) {
    if (exercise.type !== "move" && exercise.type !== "lab") return;
    if (engaged) {
      showFeedback("在当前局面回放", "点「重置局面」可以在原局面尝试另一着，也可以选择右侧候选着。");
      return;
    }
    const game = exercise.type === "lab" ? frames[frameIndex].game : base;
    if (game.isGameOver()) return;
    const item = game.get(square);
    if (square === selected) {
      clearSelection();
    } else if (item?.color === game.turn()) {
      selected = square;
      promotion.hidden = true;
      legalTargets = game.moves({square, verbose: true}).map(move => move.to);
    } else if (selected) {
      const moving = game.get(selected);
      const isPromotion = moving.type === "p" && (square.endsWith("8") || square.endsWith("1"));
      if (isPromotion && legalTargets.includes(square)) {
        showPromotion(selected, square);
        return;
      }
      attempt(selected + square);
      return;
    }
    renderBoard();
  }
  function attempt(spec, showAnswer = false) {
    if (exercise.type === "lab") {
      playLabMove(spec);
      return;
    }
    clearSelection();
    currentChoice = spec;
    const result = exercise.moves[spec];
    try {
      frames = makeFrames([spec, ...(result?.line || [])]);
    } catch {
      frames = makeFrames();
      frameIndex = 0;
      engaged = false;
      showFeedback("这步不合法", result?.text || "看一下棋子的走法、挡路的子，以及走后己方的王是否安全。", "try");
      refresh();
      return;
    }
    frameIndex = 1;
    engaged = true;
    if (result?.good && !showAnswer) complete();
    const title = showAnswer ? "示范走法" : result?.good ? "抓住了这题的要点" : result ? "比较一下后续" : "这步合法";
    let message = result?.text || "这步可以走。重置后，试着按照题目给出的目标找一着。";
    if (frames.length > 2) message += " 点「下一手」逐步看回应。";
    showFeedback(title, message, result?.good || showAnswer ? "" : "try");
    refresh();
  }
  function playLabMove(spec) {
    clearSelection();
    const sequence = frames.slice(1, frameIndex + 1).map(frame => frame.move.san);
    try {
      frames = makeFrames([...sequence, spec]);
    } catch {
      showFeedback("这步不合法", "检查棋子的走法、挡路的子，以及走后己方的王是否安全。", "try");
      refresh();
      return;
    }
    frameIndex = frames.length - 1;
    const game = frames[frameIndex].game;
    if (game.isCheckmate()) {
      complete();
      showFeedback("练成了将死", "回退一手，看看对方的王为什么走不了、吃不了，也无法挡住攻击。");
    } else if (game.isStalemate()) {
      showFeedback("走成了逼和", "轮到的一方当前没有被将军，却没有任何合法着法。回退一手，给王留一格。", "try");
    } else if (game.isDraw()) {
      showFeedback("对局和棋", "可以回退后换一个计划，或重置局面从头练。", "try");
    } else {
      showFeedback("已走 " + frames[frameIndex].move.san, "现在替另一方找最顽强的回应。回退后可以从那一步试另一条线。");
    }
    refresh();
  }
  function choose(index, showAnswer = false) {
    const result = exercise.choices[index];
    currentChoice = index;
    clearSelection();
    marked = result.marks || [];
    frames = makeFrames(result.line || []);
    frameIndex = frames.length === 1 ? 0 : 1;
    if (result.good && !showAnswer) complete();
    let message = result.text;
    if (frames.length > 2) message += " 点「下一手」看回吃。";
    showFeedback(showAnswer ? "题目讲解" : result.good ? "判断正确" : "再比较一下", message, result.good || showAnswer ? "" : "try");
    refresh();
  }
  function renderStudyNote() {
    const variation = exercise.variations[variationIndex];
    if (frameIndex === 0) showFeedback("起始局面", "逐手推进，先猜双方为何这么走，再看讲解。");
    else showFeedback(frames[frameIndex].move.san, variation.notes[frameIndex - 1]);
  }
  function changeFrame(amount) {
    const nextIndex = frameIndex + amount;
    if (nextIndex < 0 || nextIndex >= frames.length) return;
    frameIndex = nextIndex;
    clearSelection();
    if (exercise.type === "study") {
      if (frameIndex === frames.length - 1) complete();
      renderStudyNote();
    }
    if (exercise.type === "lab") {
      showFeedback("回到第 " + frameIndex + " 手", "点棋盘继续走，或用「下一手」回放原来的走法。");
    }
    const buttonLabel = amount > 0 ? "next" : "previous";
    const regainFocus = document.activeElement?.dataset.line === buttonLabel;
    refresh();
    if (regainFocus) {
      const focusTarget = controls.querySelector("[data-line=" + buttonLabel + "]");
      if (focusTarget && !focusTarget.disabled) focusTarget.focus();
      else controls.querySelector("[data-line]:not(:disabled)")?.focus();
    }
  }
  function lineControls() {
    const panel = el("div");
    const row = el("div", "line-nav");
    const previous = button("上一手", () => changeFrame(-1));
    const next = button("下一手", () => changeFrame(1));
    previous.dataset.line = "previous";
    next.dataset.line = "next";
    previous.disabled = frameIndex === 0;
    next.disabled = frameIndex >= frames.length - 1;
    row.append(previous, next, el("span", "", frameIndex + " / " + (frames.length - 1)));
    const moves = frames.slice(1, frameIndex + 1).map(frame => frame.move.san).join(" · ");
    panel.append(row, el("div", "moves", moves));
    const checkpoints = exercise.variations?.[variationIndex]?.checkpoints;
    if (checkpoints) {
      const jumps = el("div", "options line-jumps");
      for (const [step, label] of checkpoints) jumps.append(button(label, () => changeFrame(step - frameIndex)));
      panel.append(jumps);
    }
    return panel;
  }
  function renderControls() {
    controls.replaceChildren();
    if (exercise.material) controls.append(renderTurnScore());
    const options = el("div", "options");
    if (exercise.type === "move") {
      for (const [spec, label] of exercise.options) {
        const node = button(label, () => attempt(spec));
        node.setAttribute("aria-pressed", String(currentChoice === spec));
        options.append(node);
      }
    } else if (exercise.type === "quiz") {
      exercise.choices.forEach((choice, index) => {
        const node = button(choice.label, () => choose(index));
        node.setAttribute("aria-pressed", String(currentChoice === index));
        options.append(node);
      });
    } else if (exercise.type === "study") {
      options.classList.add("opening-lines");
      exercise.variations.forEach((variation, index) => {
        const node = button(variation.label, () => {
          variationIndex = index;
          reset();
        });
        node.setAttribute("aria-pressed", String(index === variationIndex));
        options.append(node);
      });
    } else {
      options.append(el("p", "lab-help", "你来走双方。选棋子再选落点，可以回退并分支。"));
    }
    controls.append(options);
    if (frames.length > 2 || ["study", "lab"].includes(exercise.type)) controls.append(lineControls());
    if (exercise.source) {
      const source = el("a", "source-link", exercise.source[0]);
      source.href = exercise.source[1];
      source.target = "_blank";
      source.rel = "noopener";
      controls.append(source);
    }
  }
  function refresh() {
    renderBoard();
    renderControls();
  }
  function reset() {
    base = makeGame();
    frames = makeFrames(exercise.type === "study" ? exercise.variations[variationIndex].moves : []);
    frameIndex = 0;
    marked = [];
    engaged = false;
    currentChoice = null;
    clearSelection();
    $("feedback").hidden = true;
    if (exercise.type === "study") renderStudyNote();
    refresh();
  }
  function hint() {
    marked = exercise.marks || [];
    showFeedback("提示", exercise.hint);
    renderBoard();
  }
  function answer() {
    if (exercise.type === "move") attempt(exercise.answer, true);
    else if (exercise.type === "quiz") choose(exercise.choices.findIndex(choice => choice.good), true);
  }
  function updateExerciseNav() {
    const nav = $("exercise-nav");
    nav.replaceChildren();
    lesson.exercises.forEach((item, index) => {
      const finished = done.has(lesson.id + "/" + index);
      const step = button(String(index + 1) + (finished ? " ✓" : ""), () => {
        setExercise(index);
        $("exercise-title").focus();
      }, "exercise-tab");
      step.setAttribute("aria-label", "练习 " + (index + 1) + "，" + item.title + (finished ? "，已完成" : ""));
      if (index === exerciseIndex) step.setAttribute("aria-current", "step");
      nav.append(step);
    });
  }
  function setExercise(index) {
    exerciseIndex = index;
    exercise = lesson.exercises[index];
    variationIndex = 0;
    saved.slots[lesson.id] = index;
    save();
    $("exercise-kind").textContent = typeLabels[exercise.type];
    $("exercise-title").textContent = exercise.title;
    $("prompt").textContent = exercise.prompt;
    $("aid").hidden = ["study", "lab"].includes(exercise.type);
    $("continue").textContent = index < lesson.exercises.length - 1 ? "下一练习" :
      lessonIndex < lessons.length - 1 ? "下一课" : "看延伸练习";
    updateExerciseNav();
    reset();
  }
  function valuesTable() {
    const table = document.createElement("table");
    const labels = table.insertRow();
    const numbers = table.insertRow();
    for (const type of ["p", "n", "b", "r", "q"]) {
      const cell = el("th", "", names[type]);
      cell.scope = "col";
      labels.append(cell);
      numbers.append(el("td", "", String(values[type])));
    }
    return table;
  }
  function setLesson(index, useSaved = true) {
    lessonIndex = index;
    lesson = lessons[index];
    $("chapter-label").textContent = "第 " + (index + 1) + " 课 / " + lessons.length + " 课";
    $("lesson-title").textContent = lesson.title;
    $("lesson-intro").textContent = lesson.intro;
    $("advanced-link").hidden = index >= 7;
    $("notes-title").textContent = lesson.notesTitle;
    const notes = $("notes");
    notes.replaceChildren();
    for (const [title, text, extra] of lesson.notes) {
      const note = el("article", "note");
      note.append(el("h3", "", title), el("p", "", text));
      if (extra === "values") note.append(valuesTable());
      notes.append(note);
    }
    const links = $("curriculum");
    links.replaceChildren();
    lessons.forEach((chapter, n) => {
      if (n === 0 || n === 7) links.append(el("p", "chapter-section", n === 0 ? "基础篇" : "进阶篇"));
      const link = el("a", "chapter-link");
      link.href = "#" + chapter.id;
      if (n === index) link.setAttribute("aria-current", "page");
      link.append(el("span", "", String(n + 1).padStart(2, "0")), document.createTextNode(chapter.nav));
      links.append(link);
    });
    const slot = useSaved ? saved.slots[lesson.id] : 0;
    setExercise(Number.isInteger(slot) && slot >= 0 && slot < lesson.exercises.length ? slot : 0);
  }
  function handleRoute() {
    const index = lessons.findIndex(item => "#" + item.id === location.hash);
    if (index < 0 || index === lessonIndex) return;
    setLesson(index);
    scrollTo(0, 0);
    $("lesson-title").focus({preventScroll: true});
  }
  $("lesson-title").tabIndex = -1;
  $("exercise-title").tabIndex = -1;
  $("reset").addEventListener("click", reset);
  $("hint").addEventListener("click", hint);
  $("answer").addEventListener("click", answer);
  $("continue").addEventListener("click", () => {
    if (exerciseIndex < lesson.exercises.length - 1) {
      setExercise(exerciseIndex + 1);
      $("exercise-title").focus();
    } else if (lessonIndex < lessons.length - 1) {
      location.hash = lessons[lessonIndex + 1].id;
    } else {
      location.hash = "references";
    }
  });
  window.addEventListener("hashchange", handleRoute);
  makeBoard();
  progress();
  const requested = lessons.findIndex(item => "#" + item.id === location.hash);
  const previous = lessons.findIndex(item => item.id === saved.last);
  setLesson(requested >= 0 ? requested : Math.max(0, previous));
})();
