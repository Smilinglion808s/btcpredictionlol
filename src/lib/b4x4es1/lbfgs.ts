// Pinned L-BFGS solver for the ES1 price head.
//
// This is a deliberate port of the numerical path scikit-learn takes for
// `LogisticRegression(solver="lbfgs")`: SciPy's L-BFGS-B driver (no bounds)
// with sklearn's option overrides
//
//   maxcor (m) = 10        (SciPy default)
//   maxls      = 50        (sklearn override; SciPy default is 20)
//   gtol       = tol       (sklearn passes its `tol`, default 1e-4)
//   ftol       = 64 * eps  (relative f-reduction stop)
//   maxiter    = max_iter
//
// and the MINPACK-2 `dcsrch`/`dcstep` More-Thuente line search that L-BFGS-B
// uses internally with ftol=1e-3, gtol=0.9, xtol=0.1.
//
// With no bounds the L-BFGS-B generalized Cauchy point never fixes a variable
// and subspace minimisation reduces to the standard two-loop recursion with
// H0 = (s.y / y.y) I, which is what this file implements.
//
// Nothing here is tunable at runtime: every constant is part of the frozen
// numerical specification and is hashed into the certified fitter code hash.

export const LBFGS_MAXCOR = 10;
export const LBFGS_MAXLS = 50;
export const LBFGS_FTOL = 64 * Number.EPSILON;
export const LBFGS_GTOL = 1e-4;
export const LS_FTOL = 1e-3;
export const LS_GTOL = 0.9;
export const LS_XTOL = 0.1;
export const LBFGS_STPMX = 1e10;

export interface LbfgsResult {
  x: number[];
  f: number;
  g: number[];
  iterations: number;
  funcCalls: number;
  converged: boolean;
  /** Sup-norm of the final gradient. */
  gradientNorm: number;
  stopReason: string;
}

type Objective = (x: readonly number[]) => { f: number; g: number[] };

const dot = (a: readonly number[], b: readonly number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const supNorm = (a: readonly number[]) => {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m;
};

// ---------------------------------------------------------------- dcstep --
// MINPACK-2 dcstep: one safeguarded step of the More-Thuente search.
interface StepState {
  stx: number;
  fx: number;
  dx: number;
  sty: number;
  fy: number;
  dy: number;
  stp: number;
  brackt: boolean;
}

function dcstep(
  s: StepState,
  fp: number,
  dp: number,
  stpmin: number,
  stpmax: number,
): void {
  const sgnd = dp * (s.dx / Math.abs(s.dx));
  let stpf: number;

  if (fp > s.fx) {
    // Case 1: higher function value — minimum is bracketed.
    const theta = (3 * (s.fx - fp)) / (s.stp - s.stx) + s.dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(s.dx), Math.abs(dp));
    let gamma = sc * Math.sqrt((theta / sc) * (theta / sc) - (s.dx / sc) * (dp / sc));
    if (s.stp < s.stx) gamma = -gamma;
    const p = gamma - s.dx + theta;
    const q = gamma - s.dx + gamma + dp;
    const r = p / q;
    const stpc = s.stx + r * (s.stp - s.stx);
    const stpq = s.stx + (s.dx / ((s.fx - fp) / (s.stp - s.stx) + s.dx) / 2) * (s.stp - s.stx);
    stpf =
      Math.abs(stpc - s.stx) <= Math.abs(stpq - s.stx) ? stpc : stpc + (stpq - stpc) / 2;
    s.brackt = true;
  } else if (sgnd < 0) {
    // Case 2: lower value, derivatives of opposite sign — bracketed.
    const theta = (3 * (s.fx - fp)) / (s.stp - s.stx) + s.dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(s.dx), Math.abs(dp));
    let gamma = sc * Math.sqrt((theta / sc) * (theta / sc) - (s.dx / sc) * (dp / sc));
    if (s.stp > s.stx) gamma = -gamma;
    const p = gamma - dp + theta;
    const q = gamma - dp + gamma + s.dx;
    const r = p / q;
    const stpc = s.stp + r * (s.stx - s.stp);
    const stpq = s.stp + (dp / (dp - s.dx)) * (s.stx - s.stp);
    stpf = Math.abs(stpc - s.stp) > Math.abs(stpq - s.stp) ? stpc : stpq;
    s.brackt = true;
  } else if (Math.abs(dp) < Math.abs(s.dx)) {
    // Case 3: lower value, same sign, derivative decreases in magnitude.
    const theta = (3 * (s.fx - fp)) / (s.stp - s.stx) + s.dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(s.dx), Math.abs(dp));
    const inner = (theta / sc) * (theta / sc) - (s.dx / sc) * (dp / sc);
    let gamma = sc * Math.sqrt(Math.max(0, inner));
    if (s.stp > s.stx) gamma = -gamma;
    const p = gamma - dp + theta;
    const q = gamma + (s.dx - dp) + gamma;
    const r = p / q;
    let stpc: number;
    if (r < 0 && gamma !== 0) stpc = s.stp + r * (s.stx - s.stp);
    else if (s.stp > s.stx) stpc = stpmax;
    else stpc = stpmin;
    const stpq = s.stp + (dp / (dp - s.dx)) * (s.stx - s.stp);
    if (s.brackt) {
      // Closest safeguarded step to stp.
      stpf = Math.abs(stpc - s.stp) < Math.abs(stpq - s.stp) ? stpc : stpq;
      if (s.stp > s.stx) stpf = Math.min(s.stp + 0.66 * (s.sty - s.stp), stpf);
      else stpf = Math.max(s.stp + 0.66 * (s.sty - s.stp), stpf);
    } else {
      stpf = Math.abs(stpc - s.stp) > Math.abs(stpq - s.stp) ? stpc : stpq;
      stpf = Math.min(stpmax, stpf);
      stpf = Math.max(stpmin, stpf);
    }
  } else {
    // Case 4: lower value, same sign, derivative does not decrease.
    if (s.brackt) {
      const theta = (3 * (fp - s.fy)) / (s.sty - s.stp) + s.dy + dp;
      const sc = Math.max(Math.abs(theta), Math.abs(s.dy), Math.abs(dp));
      let gamma = sc * Math.sqrt((theta / sc) * (theta / sc) - (s.dy / sc) * (dp / sc));
      if (s.stp > s.sty) gamma = -gamma;
      const p = gamma - dp + theta;
      const q = gamma - dp + gamma + s.dy;
      const r = p / q;
      stpf = s.stp + r * (s.sty - s.stp);
    } else if (s.stp > s.stx) {
      stpf = stpmax;
    } else {
      stpf = stpmin;
    }
  }

  // Update the interval of uncertainty.
  if (fp > s.fx) {
    s.sty = s.stp;
    s.fy = fp;
    s.dy = dp;
  } else {
    if (sgnd < 0) {
      s.sty = s.stx;
      s.fy = s.fx;
      s.dy = s.dx;
    }
    s.stx = s.stp;
    s.fx = fp;
    s.dx = dp;
  }
  s.stp = stpf;
}

// ---------------------------------------------------------------- dcsrch --
interface SearchState extends StepState {
  stage: 1 | 2;
  finit: number;
  ginit: number;
  gtest: number;
  width: number;
  width1: number;
  stmin: number;
  stmax: number;
  task: "FG" | "CONV" | "WARN" | "ERROR";
}

function dcsrchStart(stp: number, f: number, g: number, stpmax: number): SearchState {
  return {
    stage: 1,
    finit: f,
    ginit: g,
    gtest: LS_FTOL * g,
    width: stpmax - 0,
    width1: (stpmax - 0) / 0.5,
    stx: 0,
    fx: f,
    dx: g,
    sty: 0,
    fy: f,
    dy: g,
    stp,
    brackt: false,
    stmin: 0,
    stmax: stp + 4 * stp,
    task: "FG",
  };
}

function dcsrchStep(s: SearchState, f: number, g: number, stpmax: number): void {
  const ftest = s.finit + s.stp * s.gtest;
  if (s.stage === 1 && f <= ftest && g >= 0) s.stage = 2;

  // Convergence / warning tests.
  if (s.brackt && (s.stp <= s.stmin || s.stp >= s.stmax)) {
    s.task = "WARN";
    return;
  }
  if (s.brackt && s.stmax - s.stmin <= LS_XTOL * s.stmax) {
    s.task = "WARN";
    return;
  }
  if (s.stp === stpmax && f <= ftest && g <= s.gtest) {
    s.task = "WARN";
    return;
  }
  if (s.stp === 0 && (f > ftest || g >= s.gtest)) {
    s.task = "WARN";
    return;
  }
  if (f <= ftest && Math.abs(g) <= LS_GTOL * -s.ginit) {
    s.task = "CONV";
    return;
  }

  // Modified function for stage 1 (More-Thuente).
  if (s.stage === 1 && f <= s.fx && f > ftest) {
    const fm = f - s.stp * s.gtest;
    const fxm = s.fx - s.stx * s.gtest;
    const fym = s.fy - s.sty * s.gtest;
    const gm = g - s.gtest;
    const gxm = s.dx - s.gtest;
    const gym = s.dy - s.gtest;
    const proxy: StepState = {
      stx: s.stx,
      fx: fxm,
      dx: gxm,
      sty: s.sty,
      fy: fym,
      dy: gym,
      stp: s.stp,
      brackt: s.brackt,
    };
    dcstep(proxy, fm, gm, s.stmin, s.stmax);
    s.stx = proxy.stx;
    s.fx = proxy.fx + proxy.stx * s.gtest;
    s.dx = proxy.dx + s.gtest;
    s.sty = proxy.sty;
    s.fy = proxy.fy + proxy.sty * s.gtest;
    s.dy = proxy.dy + s.gtest;
    s.stp = proxy.stp;
    s.brackt = proxy.brackt;
  } else {
    const proxy: StepState = {
      stx: s.stx,
      fx: s.fx,
      dx: s.dx,
      sty: s.sty,
      fy: s.fy,
      dy: s.dy,
      stp: s.stp,
      brackt: s.brackt,
    };
    dcstep(proxy, f, g, s.stmin, s.stmax);
    s.stx = proxy.stx;
    s.fx = proxy.fx;
    s.dx = proxy.dx;
    s.sty = proxy.sty;
    s.fy = proxy.fy;
    s.dy = proxy.dy;
    s.stp = proxy.stp;
    s.brackt = proxy.brackt;
  }

  // Bisection when progress is insufficient.
  if (s.brackt) {
    if (Math.abs(s.sty - s.stx) >= 0.66 * s.width1) s.stp = s.stx + 0.5 * (s.sty - s.stx);
    s.width1 = s.width;
    s.width = Math.abs(s.sty - s.stx);
  }

  if (s.brackt) {
    s.stmin = Math.min(s.stx, s.sty);
    s.stmax = Math.max(s.stx, s.sty);
  } else {
    s.stmin = s.stp + 1.1 * (s.stp - s.stx);
    s.stmax = s.stp + 4 * (s.stp - s.stx);
  }
  s.stp = Math.max(0, Math.min(stpmax, s.stp));
  if (
    (s.brackt && (s.stp <= s.stmin || s.stp >= s.stmax)) ||
    (s.brackt && s.stmax - s.stmin <= LS_XTOL * s.stmax)
  ) {
    s.stp = s.stx;
  }
  s.task = "FG";
}

// ----------------------------------------------------------------- lbfgs --
/** L-BFGS (no bounds) with the pinned SciPy/sklearn settings. */
export function lbfgsMinimize(
  fun: Objective,
  x0: readonly number[],
  maxIter: number,
  gtol = LBFGS_GTOL,
): LbfgsResult {
  const n = x0.length;
  let x = [...x0];
  let { f, g } = fun(x);
  let funcCalls = 1;
  const S: number[][] = [];
  const Y: number[][] = [];
  const rho: number[] = [];
  let iterations = 0;
  let stopReason = "maxiter";
  let converged = false;

  if (supNorm(g) <= gtol) {
    return {
      x,
      f,
      g,
      iterations: 0,
      funcCalls,
      converged: true,
      gradientNorm: supNorm(g),
      stopReason: "gtol",
    };
  }

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Two-loop recursion: d = -H g.
    const q = g.map((v) => -v);
    const alpha: number[] = new Array(S.length).fill(0);
    for (let i = S.length - 1; i >= 0; i--) {
      alpha[i] = rho[i] * dot(S[i], q);
      for (let j = 0; j < n; j++) q[j] -= alpha[i] * Y[i][j];
    }
    if (S.length > 0) {
      const k = S.length - 1;
      const gammaK = dot(S[k], Y[k]) / dot(Y[k], Y[k]);
      for (let j = 0; j < n; j++) q[j] *= gammaK;
    }
    for (let i = 0; i < S.length; i++) {
      const beta = rho[i] * dot(Y[i], q);
      for (let j = 0; j < n; j++) q[j] += S[i][j] * (alpha[i] - beta);
    }
    const d = q;

    const dg = dot(g, d);
    if (!(dg < 0)) {
      stopReason = "non_descent";
      break;
    }

    // Initial step: 1/||d|| on the first iteration, 1 afterwards (L-BFGS-B).
    let stp = iter === 0 ? 1 / Math.sqrt(dot(d, d)) : 1;
    const stpmax = LBFGS_STPMX;
    stp = Math.min(stp, stpmax);

    const ls = dcsrchStart(stp, f, dg, stpmax);
    let xNew = x;
    let fNew = f;
    let gNew = g;
    let lsOk = false;
    for (let k = 0; k < LBFGS_MAXLS; k++) {
      xNew = x.map((v, j) => v + ls.stp * d[j]);
      const r = fun(xNew);
      funcCalls++;
      fNew = r.f;
      gNew = r.g;
      dcsrchStep(ls, fNew, dot(gNew, d), stpmax);
      if (ls.task === "CONV") {
        lsOk = true;
        break;
      }
      if (ls.task !== "FG") break;
    }
    if (!lsOk && !(fNew < f)) {
      stopReason = "line_search";
      break;
    }

    const s = xNew.map((v, j) => v - x[j]);
    const y = gNew.map((v, j) => v - g[j]);
    const sy = dot(s, y);
    const yy = dot(y, y);
    // L-BFGS-B memory acceptance test.
    if (sy > Number.EPSILON * yy) {
      S.push(s);
      Y.push(y);
      rho.push(1 / sy);
      if (S.length > LBFGS_MAXCOR) {
        S.shift();
        Y.shift();
        rho.shift();
      }
    }

    const fOld = f;
    x = xNew;
    f = fNew;
    g = gNew;

    if (supNorm(g) <= gtol) {
      converged = true;
      stopReason = "gtol";
      break;
    }
    if (fOld - f <= LBFGS_FTOL * Math.max(Math.abs(fOld), Math.abs(f), 1)) {
      converged = true;
      stopReason = "ftol";
      break;
    }
  }

  return {
    x,
    f,
    g,
    iterations,
    funcCalls,
    converged,
    gradientNorm: supNorm(g),
    stopReason,
  };
}
