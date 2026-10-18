var Wm = Object.create;
var tf = Object.defineProperty;
var Fm = Object.getOwnPropertyDescriptor;
var Pm = Object.getOwnPropertyNames;
var ev = Object.getPrototypeOf,
  tv = Object.prototype.hasOwnProperty;
var mt = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
var nv = (e, t, n, i) => {
  if ((t && typeof t == "object") || typeof t == "function")
    for (let a of Pm(t))
      !tv.call(e, a) && a !== n && tf(e, a, { get: () => t[a], enumerable: !(i = Fm(t, a)) || i.enumerable });
  return e;
};
var mi = (e, t, n) => (
  (n = e != null ? Wm(ev(e)) : {}),
  nv(t || !e || !e.__esModule ? tf(n, "default", { value: e, enumerable: !0 }) : n, e)
);
var df = mt((W) => {
  "use strict";
  function Hs(e, t) {
    var n = e.length;
    e.push(t);
    e: for (; 0 < n;) {
      var i = (n - 1) >>> 1,
        a = e[i];
      if (0 < Cl(a, t)) ((e[i] = t), (e[n] = a), (n = i));
      else break e;
    }
  }
  function vt(e) {
    return e.length === 0 ? null : e[0];
  }
  function Nl(e) {
    if (e.length === 0) return null;
    var t = e[0],
      n = e.pop();
    if (n !== t) {
      e[0] = n;
      e: for (var i = 0, a = e.length, l = a >>> 1; i < l;) {
        var r = 2 * (i + 1) - 1,
          s = e[r],
          u = r + 1,
          o = e[u];
        if (0 > Cl(s, n)) u < a && 0 > Cl(o, s) ? ((e[i] = o), (e[u] = n), (i = u)) : ((e[i] = s), (e[r] = n), (i = r));
        else if (u < a && 0 > Cl(o, n)) ((e[i] = o), (e[u] = n), (i = u));
        else break e;
      }
    }
    return t;
  }
  function Cl(e, t) {
    var n = e.sortIndex - t.sortIndex;
    return n !== 0 ? n : e.id - t.id;
  }
  W.unstable_now = void 0;
  typeof performance == "object" && typeof performance.now == "function"
    ? ((nf = performance),
      (W.unstable_now = function () {
        return nf.now();
      }))
    : ((Ms = Date),
      (af = Ms.now()),
      (W.unstable_now = function () {
        return Ms.now() - af;
      }));
  var nf,
    Ms,
    af,
    xt = [],
    Ft = [],
    iv = 1,
    Fe = null,
    Te = 3,
    Bs = !1,
    wa = !1,
    Sa = !1,
    Gs = !1,
    sf = typeof setTimeout == "function" ? setTimeout : null,
    uf = typeof clearTimeout == "function" ? clearTimeout : null,
    lf = typeof setImmediate < "u" ? setImmediate : null;
  function Ul(e) {
    for (var t = vt(Ft); t !== null;) {
      if (t.callback === null) Nl(Ft);
      else if (t.startTime <= e) (Nl(Ft), (t.sortIndex = t.expirationTime), Hs(xt, t));
      else break;
      t = vt(Ft);
    }
  }
  function Ks(e) {
    if (((Sa = !1), Ul(e), !wa))
      if (vt(xt) !== null) ((wa = !0), pi || ((pi = !0), vi()));
      else {
        var t = vt(Ft);
        t !== null && Ys(Ks, t.startTime - e);
      }
  }
  var pi = !1,
    Ea = -1,
    of = 5,
    cf = -1;
  function ff() {
    return Gs ? !0 : !(W.unstable_now() - cf < of);
  }
  function qs() {
    if (((Gs = !1), pi)) {
      var e = W.unstable_now();
      cf = e;
      var t = !0;
      try {
        e: {
          ((wa = !1), Sa && ((Sa = !1), uf(Ea), (Ea = -1)), (Bs = !0));
          var n = Te;
          try {
            t: {
              for (Ul(e), Fe = vt(xt); Fe !== null && !(Fe.expirationTime > e && ff());) {
                var i = Fe.callback;
                if (typeof i == "function") {
                  ((Fe.callback = null), (Te = Fe.priorityLevel));
                  var a = i(Fe.expirationTime <= e);
                  if (((e = W.unstable_now()), typeof a == "function")) {
                    ((Fe.callback = a), Ul(e), (t = !0));
                    break t;
                  }
                  (Fe === vt(xt) && Nl(xt), Ul(e));
                } else Nl(xt);
                Fe = vt(xt);
              }
              if (Fe !== null) t = !0;
              else {
                var l = vt(Ft);
                (l !== null && Ys(Ks, l.startTime - e), (t = !1));
              }
            }
            break e;
          } finally {
            ((Fe = null), (Te = n), (Bs = !1));
          }
          t = void 0;
        }
      } finally {
        t ? vi() : (pi = !1);
      }
    }
  }
  var vi;
  typeof lf == "function"
    ? (vi = function () {
        lf(qs);
      })
    : typeof MessageChannel < "u"
      ? ((Ls = new MessageChannel()),
        (rf = Ls.port2),
        (Ls.port1.onmessage = qs),
        (vi = function () {
          rf.postMessage(null);
        }))
      : (vi = function () {
          sf(qs, 0);
        });
  var Ls, rf;
  function Ys(e, t) {
    Ea = sf(function () {
      e(W.unstable_now());
    }, t);
  }
  W.unstable_IdlePriority = 5;
  W.unstable_ImmediatePriority = 1;
  W.unstable_LowPriority = 4;
  W.unstable_NormalPriority = 3;
  W.unstable_Profiling = null;
  W.unstable_UserBlockingPriority = 2;
  W.unstable_cancelCallback = function (e) {
    e.callback = null;
  };
  W.unstable_forceFrameRate = function (e) {
    0 > e || 125 < e
      ? console.error(
          "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
        )
      : (of = 0 < e ? Math.floor(1e3 / e) : 5);
  };
  W.unstable_getCurrentPriorityLevel = function () {
    return Te;
  };
  W.unstable_next = function (e) {
    switch (Te) {
      case 1:
      case 2:
      case 3:
        var t = 3;
        break;
      default:
        t = Te;
    }
    var n = Te;
    Te = t;
    try {
      return e();
    } finally {
      Te = n;
    }
  };
  W.unstable_requestPaint = function () {
    Gs = !0;
  };
  W.unstable_runWithPriority = function (e, t) {
    switch (e) {
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        break;
      default:
        e = 3;
    }
    var n = Te;
    Te = e;
    try {
      return t();
    } finally {
      Te = n;
    }
  };
  W.unstable_scheduleCallback = function (e, t, n) {
    var i = W.unstable_now();
    switch (
      (typeof n == "object" && n !== null ? ((n = n.delay), (n = typeof n == "number" && 0 < n ? i + n : i)) : (n = i),
      e)
    ) {
      case 1:
        var a = -1;
        break;
      case 2:
        a = 250;
        break;
      case 5:
        a = 1073741823;
        break;
      case 4:
        a = 1e4;
        break;
      default:
        a = 5e3;
    }
    return (
      (a = n + a),
      (e = { id: iv++, callback: t, priorityLevel: e, startTime: n, expirationTime: a, sortIndex: -1 }),
      n > i
        ? ((e.sortIndex = n),
          Hs(Ft, e),
          vt(xt) === null && e === vt(Ft) && (Sa ? (uf(Ea), (Ea = -1)) : (Sa = !0), Ys(Ks, n - i)))
        : ((e.sortIndex = a), Hs(xt, e), wa || Bs || ((wa = !0), pi || ((pi = !0), vi()))),
      e
    );
  };
  W.unstable_shouldYield = ff;
  W.unstable_wrapCallback = function (e) {
    var t = Te;
    return function () {
      var n = Te;
      Te = t;
      try {
        return e.apply(this, arguments);
      } finally {
        Te = n;
      }
    };
  };
});
var gf = mt((C_, hf) => {
  "use strict";
  hf.exports = df();
});
var Rf = mt((N) => {
  "use strict";
  var Xs = Symbol.for("react.transitional.element"),
    av = Symbol.for("react.portal"),
    lv = Symbol.for("react.fragment"),
    rv = Symbol.for("react.strict_mode"),
    sv = Symbol.for("react.profiler"),
    uv = Symbol.for("react.consumer"),
    ov = Symbol.for("react.context"),
    cv = Symbol.for("react.forward_ref"),
    fv = Symbol.for("react.suspense"),
    dv = Symbol.for("react.memo"),
    _f = Symbol.for("react.lazy"),
    hv = Symbol.for("react.activity"),
    yf = Symbol.iterator;
  function gv(e) {
    return e === null || typeof e != "object"
      ? null
      : ((e = (yf && e[yf]) || e["@@iterator"]), typeof e == "function" ? e : null);
  }
  var bf = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    wf = Object.assign,
    Sf = {};
  function bi(e, t, n) {
    ((this.props = e), (this.context = t), (this.refs = Sf), (this.updater = n || bf));
  }
  bi.prototype.isReactComponent = {};
  bi.prototype.setState = function (e, t) {
    if (typeof e != "object" && typeof e != "function" && e != null)
      throw Error(
        "takes an object of state variables to update or a function which returns an object of state variables.",
      );
    this.updater.enqueueSetState(this, e, t, "setState");
  };
  bi.prototype.forceUpdate = function (e) {
    this.updater.enqueueForceUpdate(this, e, "forceUpdate");
  };
  function Ef() {}
  Ef.prototype = bi.prototype;
  function Qs(e, t, n) {
    ((this.props = e), (this.context = t), (this.refs = Sf), (this.updater = n || bf));
  }
  var Js = (Qs.prototype = new Ef());
  Js.constructor = Qs;
  wf(Js, bi.prototype);
  Js.isPureReactComponent = !0;
  var mf = Array.isArray;
  function Vs() {}
  var Q = { H: null, A: null, T: null, S: null },
    Af = Object.prototype.hasOwnProperty;
  function Zs(e, t, n) {
    var i = n.ref;
    return { $$typeof: Xs, type: e, key: t, ref: i !== void 0 ? i : null, props: n };
  }
  function yv(e, t) {
    return Zs(e.type, t, e.props);
  }
  function $s(e) {
    return typeof e == "object" && e !== null && e.$$typeof === Xs;
  }
  function mv(e) {
    var t = { "=": "=0", ":": "=2" };
    return (
      "$" +
      e.replace(/[=:]/g, function (n) {
        return t[n];
      })
    );
  }
  var vf = /\/+/g;
  function Is(e, t) {
    return typeof e == "object" && e !== null && e.key != null ? mv("" + e.key) : t.toString(36);
  }
  function vv(e) {
    switch (e.status) {
      case "fulfilled":
        return e.value;
      case "rejected":
        throw e.reason;
      default:
        switch (
          (typeof e.status == "string"
            ? e.then(Vs, Vs)
            : ((e.status = "pending"),
              e.then(
                function (t) {
                  e.status === "pending" && ((e.status = "fulfilled"), (e.value = t));
                },
                function (t) {
                  e.status === "pending" && ((e.status = "rejected"), (e.reason = t));
                },
              )),
          e.status)
        ) {
          case "fulfilled":
            return e.value;
          case "rejected":
            throw e.reason;
        }
    }
    throw e;
  }
  function _i(e, t, n, i, a) {
    var l = typeof e;
    (l === "undefined" || l === "boolean") && (e = null);
    var r = !1;
    if (e === null) r = !0;
    else
      switch (l) {
        case "bigint":
        case "string":
        case "number":
          r = !0;
          break;
        case "object":
          switch (e.$$typeof) {
            case Xs:
            case av:
              r = !0;
              break;
            case _f:
              return ((r = e._init), _i(r(e._payload), t, n, i, a));
          }
      }
    if (r)
      return (
        (a = a(e)),
        (r = i === "" ? "." + Is(e, 0) : i),
        mf(a)
          ? ((n = ""),
            r != null && (n = r.replace(vf, "$&/") + "/"),
            _i(a, t, n, "", function (o) {
              return o;
            }))
          : a != null &&
            ($s(a) &&
              (a = yv(
                a,
                n + (a.key == null || (e && e.key === a.key) ? "" : ("" + a.key).replace(vf, "$&/") + "/") + r,
              )),
            t.push(a)),
        1
      );
    r = 0;
    var s = i === "" ? "." : i + ":";
    if (mf(e)) for (var u = 0; u < e.length; u++) ((i = e[u]), (l = s + Is(i, u)), (r += _i(i, t, n, l, a)));
    else if (((u = gv(e)), typeof u == "function"))
      for (e = u.call(e), u = 0; !(i = e.next()).done;) ((i = i.value), (l = s + Is(i, u++)), (r += _i(i, t, n, l, a)));
    else if (l === "object") {
      if (typeof e.then == "function") return _i(vv(e), t, n, i, a);
      throw (
        (t = String(e)),
        Error(
          "Objects are not valid as a React child (found: " +
            (t === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : t) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    }
    return r;
  }
  function Dl(e, t, n) {
    if (e == null) return e;
    var i = [],
      a = 0;
    return (
      _i(e, i, "", "", function (l) {
        return t.call(n, l, a++);
      }),
      i
    );
  }
  function pv(e) {
    if (e._status === -1) {
      var t = e._result;
      ((t = t()),
        t.then(
          function (n) {
            (e._status === 0 || e._status === -1) && ((e._status = 1), (e._result = n));
          },
          function (n) {
            (e._status === 0 || e._status === -1) && ((e._status = 2), (e._result = n));
          },
        ),
        e._status === -1 && ((e._status = 0), (e._result = t)));
    }
    if (e._status === 1) return e._result.default;
    throw e._result;
  }
  var pf =
      typeof reportError == "function"
        ? reportError
        : function (e) {
            if (typeof window == "object" && typeof window.ErrorEvent == "function") {
              var t = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  typeof e == "object" && e !== null && typeof e.message == "string" ? String(e.message) : String(e),
                error: e,
              });
              if (!window.dispatchEvent(t)) return;
            } else if (typeof process == "object" && typeof process.emit == "function") {
              process.emit("uncaughtException", e);
              return;
            }
            console.error(e);
          },
    _v = {
      map: Dl,
      forEach: function (e, t, n) {
        Dl(
          e,
          function () {
            t.apply(this, arguments);
          },
          n,
        );
      },
      count: function (e) {
        var t = 0;
        return (
          Dl(e, function () {
            t++;
          }),
          t
        );
      },
      toArray: function (e) {
        return (
          Dl(e, function (t) {
            return t;
          }) || []
        );
      },
      only: function (e) {
        if (!$s(e)) throw Error("React.Children.only expected to receive a single React element child.");
        return e;
      },
    };
  N.Activity = hv;
  N.Children = _v;
  N.Component = bi;
  N.Fragment = lv;
  N.Profiler = sv;
  N.PureComponent = Qs;
  N.StrictMode = rv;
  N.Suspense = fv;
  N.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Q;
  N.__COMPILER_RUNTIME = {
    __proto__: null,
    c: function (e) {
      return Q.H.useMemoCache(e);
    },
  };
  N.cache = function (e) {
    return function () {
      return e.apply(null, arguments);
    };
  };
  N.cacheSignal = function () {
    return null;
  };
  N.cloneElement = function (e, t, n) {
    if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
    var i = wf({}, e.props),
      a = e.key;
    if (t != null)
      for (l in (t.key !== void 0 && (a = "" + t.key), t))
        !Af.call(t, l) ||
          l === "key" ||
          l === "__self" ||
          l === "__source" ||
          (l === "ref" && t.ref === void 0) ||
          (i[l] = t[l]);
    var l = arguments.length - 2;
    if (l === 1) i.children = n;
    else if (1 < l) {
      for (var r = Array(l), s = 0; s < l; s++) r[s] = arguments[s + 2];
      i.children = r;
    }
    return Zs(e.type, a, i);
  };
  N.createContext = function (e) {
    return (
      (e = { $$typeof: ov, _currentValue: e, _currentValue2: e, _threadCount: 0, Provider: null, Consumer: null }),
      (e.Provider = e),
      (e.Consumer = { $$typeof: uv, _context: e }),
      e
    );
  };
  N.createElement = function (e, t, n) {
    var i,
      a = {},
      l = null;
    if (t != null)
      for (i in (t.key !== void 0 && (l = "" + t.key), t))
        Af.call(t, i) && i !== "key" && i !== "__self" && i !== "__source" && (a[i] = t[i]);
    var r = arguments.length - 2;
    if (r === 1) a.children = n;
    else if (1 < r) {
      for (var s = Array(r), u = 0; u < r; u++) s[u] = arguments[u + 2];
      a.children = s;
    }
    if (e && e.defaultProps) for (i in ((r = e.defaultProps), r)) a[i] === void 0 && (a[i] = r[i]);
    return Zs(e, l, a);
  };
  N.createRef = function () {
    return { current: null };
  };
  N.forwardRef = function (e) {
    return { $$typeof: cv, render: e };
  };
  N.isValidElement = $s;
  N.lazy = function (e) {
    return { $$typeof: _f, _payload: { _status: -1, _result: e }, _init: pv };
  };
  N.memo = function (e, t) {
    return { $$typeof: dv, type: e, compare: t === void 0 ? null : t };
  };
  N.startTransition = function (e) {
    var t = Q.T,
      n = {};
    Q.T = n;
    try {
      var i = e(),
        a = Q.S;
      (a !== null && a(n, i), typeof i == "object" && i !== null && typeof i.then == "function" && i.then(Vs, pf));
    } catch (l) {
      pf(l);
    } finally {
      (t !== null && n.types !== null && (t.types = n.types), (Q.T = t));
    }
  };
  N.unstable_useCacheRefresh = function () {
    return Q.H.useCacheRefresh();
  };
  N.use = function (e) {
    return Q.H.use(e);
  };
  N.useActionState = function (e, t, n) {
    return Q.H.useActionState(e, t, n);
  };
  N.useCallback = function (e, t) {
    return Q.H.useCallback(e, t);
  };
  N.useContext = function (e) {
    return Q.H.useContext(e);
  };
  N.useDebugValue = function () {};
  N.useDeferredValue = function (e, t) {
    return Q.H.useDeferredValue(e, t);
  };
  N.useEffect = function (e, t) {
    return Q.H.useEffect(e, t);
  };
  N.useEffectEvent = function (e) {
    return Q.H.useEffectEvent(e);
  };
  N.useId = function () {
    return Q.H.useId();
  };
  N.useImperativeHandle = function (e, t, n) {
    return Q.H.useImperativeHandle(e, t, n);
  };
  N.useInsertionEffect = function (e, t) {
    return Q.H.useInsertionEffect(e, t);
  };
  N.useLayoutEffect = function (e, t) {
    return Q.H.useLayoutEffect(e, t);
  };
  N.useMemo = function (e, t) {
    return Q.H.useMemo(e, t);
  };
  N.useOptimistic = function (e, t) {
    return Q.H.useOptimistic(e, t);
  };
  N.useReducer = function (e, t, n) {
    return Q.H.useReducer(e, t, n);
  };
  N.useRef = function (e) {
    return Q.H.useRef(e);
  };
  N.useState = function (e) {
    return Q.H.useState(e);
  };
  N.useSyncExternalStore = function (e, t, n) {
    return Q.H.useSyncExternalStore(e, t, n);
  };
  N.useTransition = function () {
    return Q.H.useTransition();
  };
  N.version = "19.2.5";
});
var zl = mt((N_, Tf) => {
  "use strict";
  Tf.exports = Rf();
});
var xf = mt((Ue) => {
  "use strict";
  var bv = zl();
  function Of(e) {
    var t = "https://react.dev/errors/" + e;
    if (1 < arguments.length) {
      t += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
    }
    return (
      "Minified React error #" +
      e +
      "; visit " +
      t +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function Pt() {}
  var Ce = {
      d: {
        f: Pt,
        r: function () {
          throw Error(Of(522));
        },
        D: Pt,
        C: Pt,
        L: Pt,
        m: Pt,
        X: Pt,
        S: Pt,
        M: Pt,
      },
      p: 0,
      findDOMNode: null,
    },
    wv = Symbol.for("react.portal");
  function Sv(e, t, n) {
    var i = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return { $$typeof: wv, key: i == null ? null : "" + i, children: e, containerInfo: t, implementation: n };
  }
  var Aa = bv.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function jl(e, t) {
    if (e === "font") return "";
    if (typeof t == "string") return t === "use-credentials" ? t : "";
  }
  Ue.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Ce;
  Ue.createPortal = function (e, t) {
    var n = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!t || (t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11)) throw Error(Of(299));
    return Sv(e, t, null, n);
  };
  Ue.flushSync = function (e) {
    var t = Aa.T,
      n = Ce.p;
    try {
      if (((Aa.T = null), (Ce.p = 2), e)) return e();
    } finally {
      ((Aa.T = t), (Ce.p = n), Ce.d.f());
    }
  };
  Ue.preconnect = function (e, t) {
    typeof e == "string" &&
      (t ? ((t = t.crossOrigin), (t = typeof t == "string" ? (t === "use-credentials" ? t : "") : void 0)) : (t = null),
      Ce.d.C(e, t));
  };
  Ue.prefetchDNS = function (e) {
    typeof e == "string" && Ce.d.D(e);
  };
  Ue.preinit = function (e, t) {
    if (typeof e == "string" && t && typeof t.as == "string") {
      var n = t.as,
        i = jl(n, t.crossOrigin),
        a = typeof t.integrity == "string" ? t.integrity : void 0,
        l = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
      n === "style"
        ? Ce.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
            crossOrigin: i,
            integrity: a,
            fetchPriority: l,
          })
        : n === "script" &&
          Ce.d.X(e, {
            crossOrigin: i,
            integrity: a,
            fetchPriority: l,
            nonce: typeof t.nonce == "string" ? t.nonce : void 0,
          });
    }
  };
  Ue.preinitModule = function (e, t) {
    if (typeof e == "string")
      if (typeof t == "object" && t !== null) {
        if (t.as == null || t.as === "script") {
          var n = jl(t.as, t.crossOrigin);
          Ce.d.M(e, {
            crossOrigin: n,
            integrity: typeof t.integrity == "string" ? t.integrity : void 0,
            nonce: typeof t.nonce == "string" ? t.nonce : void 0,
          });
        }
      } else t == null && Ce.d.M(e);
  };
  Ue.preload = function (e, t) {
    if (typeof e == "string" && typeof t == "object" && t !== null && typeof t.as == "string") {
      var n = t.as,
        i = jl(n, t.crossOrigin);
      Ce.d.L(e, n, {
        crossOrigin: i,
        integrity: typeof t.integrity == "string" ? t.integrity : void 0,
        nonce: typeof t.nonce == "string" ? t.nonce : void 0,
        type: typeof t.type == "string" ? t.type : void 0,
        fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
        referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
        imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
        imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
        media: typeof t.media == "string" ? t.media : void 0,
      });
    }
  };
  Ue.preloadModule = function (e, t) {
    if (typeof e == "string")
      if (t) {
        var n = jl(t.as, t.crossOrigin);
        Ce.d.m(e, {
          as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
          crossOrigin: n,
          integrity: typeof t.integrity == "string" ? t.integrity : void 0,
        });
      } else Ce.d.m(e);
  };
  Ue.requestFormReset = function (e) {
    Ce.d.r(e);
  };
  Ue.unstable_batchedUpdates = function (e, t) {
    return e(t);
  };
  Ue.useFormState = function (e, t, n) {
    return Aa.H.useFormState(e, t, n);
  };
  Ue.useFormStatus = function () {
    return Aa.H.useHostTransitionStatus();
  };
  Ue.version = "19.2.5";
});
var Uf = mt((z_, Cf) => {
  "use strict";
  function kf() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(kf);
      } catch (e) {
        console.error(e);
      }
  }
  (kf(), (Cf.exports = xf()));
});
var Yy = mt((rs) => {
  "use strict";
  var ye = gf(),
    ih = zl(),
    Ev = Uf();
  function p(e) {
    var t = "https://react.dev/errors/" + e;
    if (1 < arguments.length) {
      t += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
    }
    return (
      "Minified React error #" +
      e +
      "; visit " +
      t +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function ah(e) {
    return !(!e || (e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11));
  }
  function cl(e) {
    var t = e,
      n = e;
    if (e.alternate) for (; t.return;) t = t.return;
    else {
      e = t;
      do ((t = e), (t.flags & 4098) !== 0 && (n = t.return), (e = t.return));
      while (e);
    }
    return t.tag === 3 ? n : null;
  }
  function lh(e) {
    if (e.tag === 13) {
      var t = e.memoizedState;
      if ((t === null && ((e = e.alternate), e !== null && (t = e.memoizedState)), t !== null)) return t.dehydrated;
    }
    return null;
  }
  function rh(e) {
    if (e.tag === 31) {
      var t = e.memoizedState;
      if ((t === null && ((e = e.alternate), e !== null && (t = e.memoizedState)), t !== null)) return t.dehydrated;
    }
    return null;
  }
  function Nf(e) {
    if (cl(e) !== e) throw Error(p(188));
  }
  function Av(e) {
    var t = e.alternate;
    if (!t) {
      if (((t = cl(e)), t === null)) throw Error(p(188));
      return t !== e ? null : e;
    }
    for (var n = e, i = t; ;) {
      var a = n.return;
      if (a === null) break;
      var l = a.alternate;
      if (l === null) {
        if (((i = a.return), i !== null)) {
          n = i;
          continue;
        }
        break;
      }
      if (a.child === l.child) {
        for (l = a.child; l;) {
          if (l === n) return (Nf(a), e);
          if (l === i) return (Nf(a), t);
          l = l.sibling;
        }
        throw Error(p(188));
      }
      if (n.return !== i.return) ((n = a), (i = l));
      else {
        for (var r = !1, s = a.child; s;) {
          if (s === n) {
            ((r = !0), (n = a), (i = l));
            break;
          }
          if (s === i) {
            ((r = !0), (i = a), (n = l));
            break;
          }
          s = s.sibling;
        }
        if (!r) {
          for (s = l.child; s;) {
            if (s === n) {
              ((r = !0), (n = l), (i = a));
              break;
            }
            if (s === i) {
              ((r = !0), (i = l), (n = a));
              break;
            }
            s = s.sibling;
          }
          if (!r) throw Error(p(189));
        }
      }
      if (n.alternate !== i) throw Error(p(190));
    }
    if (n.tag !== 3) throw Error(p(188));
    return n.stateNode.current === n ? e : t;
  }
  function sh(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e;
    for (e = e.child; e !== null;) {
      if (((t = sh(e)), t !== null)) return t;
      e = e.sibling;
    }
    return null;
  }
  var $ = Object.assign,
    Rv = Symbol.for("react.element"),
    Ml = Symbol.for("react.transitional.element"),
    Na = Symbol.for("react.portal"),
    Ti = Symbol.for("react.fragment"),
    uh = Symbol.for("react.strict_mode"),
    Cu = Symbol.for("react.profiler"),
    oh = Symbol.for("react.consumer"),
    Mt = Symbol.for("react.context"),
    To = Symbol.for("react.forward_ref"),
    Uu = Symbol.for("react.suspense"),
    Nu = Symbol.for("react.suspense_list"),
    Oo = Symbol.for("react.memo"),
    en = Symbol.for("react.lazy");
  Symbol.for("react.scope");
  var Du = Symbol.for("react.activity");
  Symbol.for("react.legacy_hidden");
  Symbol.for("react.tracing_marker");
  var Tv = Symbol.for("react.memo_cache_sentinel");
  Symbol.for("react.view_transition");
  var Df = Symbol.iterator;
  function Ra(e) {
    return e === null || typeof e != "object"
      ? null
      : ((e = (Df && e[Df]) || e["@@iterator"]), typeof e == "function" ? e : null);
  }
  var Ov = Symbol.for("react.client.reference");
  function zu(e) {
    if (e == null) return null;
    if (typeof e == "function") return e.$$typeof === Ov ? null : e.displayName || e.name || null;
    if (typeof e == "string") return e;
    switch (e) {
      case Ti:
        return "Fragment";
      case Cu:
        return "Profiler";
      case uh:
        return "StrictMode";
      case Uu:
        return "Suspense";
      case Nu:
        return "SuspenseList";
      case Du:
        return "Activity";
    }
    if (typeof e == "object")
      switch (e.$$typeof) {
        case Na:
          return "Portal";
        case Mt:
          return e.displayName || "Context";
        case oh:
          return (e._context.displayName || "Context") + ".Consumer";
        case To:
          var t = e.render;
          return (
            (e = e.displayName),
            e || ((e = t.displayName || t.name || ""), (e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef")),
            e
          );
        case Oo:
          return ((t = e.displayName || null), t !== null ? t : zu(e.type) || "Memo");
        case en:
          ((t = e._payload), (e = e._init));
          try {
            return zu(e(t));
          } catch {}
      }
    return null;
  }
  var Da = Array.isArray,
    U = ih.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    B = Ev.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    Bn = { pending: !1, data: null, method: null, action: null },
    ju = [],
    Oi = -1;
  function St(e) {
    return { current: e };
  }
  function pe(e) {
    0 > Oi || ((e.current = ju[Oi]), (ju[Oi] = null), Oi--);
  }
  function X(e, t) {
    (Oi++, (ju[Oi] = e.current), (e.current = t));
  }
  var wt = St(null),
    $a = St(null),
    dn = St(null),
    yr = St(null);
  function mr(e, t) {
    switch ((X(dn, t), X($a, e), X(wt, null), t.nodeType)) {
      case 9:
      case 11:
        e = (e = t.documentElement) && (e = e.namespaceURI) ? Bd(e) : 0;
        break;
      default:
        if (((e = t.tagName), (t = t.namespaceURI))) ((t = Bd(t)), (e = ky(t, e)));
        else
          switch (e) {
            case "svg":
              e = 1;
              break;
            case "math":
              e = 2;
              break;
            default:
              e = 0;
          }
    }
    (pe(wt), X(wt, e));
  }
  function Vi() {
    (pe(wt), pe($a), pe(dn));
  }
  function Mu(e) {
    e.memoizedState !== null && X(yr, e);
    var t = wt.current,
      n = ky(t, e.type);
    t !== n && (X($a, e), X(wt, n));
  }
  function vr(e) {
    ($a.current === e && (pe(wt), pe($a)), yr.current === e && (pe(yr), (sl._currentValue = Bn)));
  }
  var Ws, zf;
  function Mn(e) {
    if (Ws === void 0)
      try {
        throw Error();
      } catch (n) {
        var t = n.stack.trim().match(/\n( *(at )?)/);
        ((Ws = (t && t[1]) || ""),
          (zf =
            -1 <
            n.stack.indexOf(`
    at`)
              ? " (<anonymous>)"
              : -1 < n.stack.indexOf("@")
                ? "@unknown:0:0"
                : ""));
      }
    return (
      `
` +
      Ws +
      e +
      zf
    );
  }
  var Fs = !1;
  function Ps(e, t) {
    if (!e || Fs) return "";
    Fs = !0;
    var n = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var i = {
        DetermineComponentFrameRoot: function () {
          try {
            if (t) {
              var m = function () {
                throw Error();
              };
              if (
                (Object.defineProperty(m.prototype, "props", {
                  set: function () {
                    throw Error();
                  },
                }),
                typeof Reflect == "object" && Reflect.construct)
              ) {
                try {
                  Reflect.construct(m, []);
                } catch (g) {
                  var d = g;
                }
                Reflect.construct(e, [], m);
              } else {
                try {
                  m.call();
                } catch (g) {
                  d = g;
                }
                e.call(m.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (g) {
                d = g;
              }
              (m = e()) && typeof m.catch == "function" && m.catch(function () {});
            }
          } catch (g) {
            if (g && d && typeof g.stack == "string") return [g.stack, d.stack];
          }
          return [null, null];
        },
      };
      i.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var a = Object.getOwnPropertyDescriptor(i.DetermineComponentFrameRoot, "name");
      a &&
        a.configurable &&
        Object.defineProperty(i.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
      var l = i.DetermineComponentFrameRoot(),
        r = l[0],
        s = l[1];
      if (r && s) {
        var u = r.split(`
`),
          o = s.split(`
`);
        for (a = i = 0; i < u.length && !u[i].includes("DetermineComponentFrameRoot");) i++;
        for (; a < o.length && !o[a].includes("DetermineComponentFrameRoot");) a++;
        if (i === u.length || a === o.length)
          for (i = u.length - 1, a = o.length - 1; 1 <= i && 0 <= a && u[i] !== o[a];) a--;
        for (; 1 <= i && 0 <= a; i--, a--)
          if (u[i] !== o[a]) {
            if (i !== 1 || a !== 1)
              do
                if ((i--, a--, 0 > a || u[i] !== o[a])) {
                  var f =
                    `
` + u[i].replace(" at new ", " at ");
                  return (
                    e.displayName && f.includes("<anonymous>") && (f = f.replace("<anonymous>", e.displayName)),
                    f
                  );
                }
              while (1 <= i && 0 <= a);
            break;
          }
      }
    } finally {
      ((Fs = !1), (Error.prepareStackTrace = n));
    }
    return (n = e ? e.displayName || e.name : "") ? Mn(n) : "";
  }
  function xv(e, t) {
    switch (e.tag) {
      case 26:
      case 27:
      case 5:
        return Mn(e.type);
      case 16:
        return Mn("Lazy");
      case 13:
        return e.child !== t && t !== null ? Mn("Suspense Fallback") : Mn("Suspense");
      case 19:
        return Mn("SuspenseList");
      case 0:
      case 15:
        return Ps(e.type, !1);
      case 11:
        return Ps(e.type.render, !1);
      case 1:
        return Ps(e.type, !0);
      case 31:
        return Mn("Activity");
      default:
        return "";
    }
  }
  function jf(e) {
    try {
      var t = "",
        n = null;
      do ((t += xv(e, n)), (n = e), (e = e.return));
      while (e);
      return t;
    } catch (i) {
      return (
        `
Error generating stack: ` +
        i.message +
        `
` +
        i.stack
      );
    }
  }
  var qu = Object.prototype.hasOwnProperty,
    xo = ye.unstable_scheduleCallback,
    eu = ye.unstable_cancelCallback,
    kv = ye.unstable_shouldYield,
    Cv = ye.unstable_requestPaint,
    Ie = ye.unstable_now,
    Uv = ye.unstable_getCurrentPriorityLevel,
    ch = ye.unstable_ImmediatePriority,
    fh = ye.unstable_UserBlockingPriority,
    pr = ye.unstable_NormalPriority,
    Nv = ye.unstable_LowPriority,
    dh = ye.unstable_IdlePriority,
    Dv = ye.log,
    zv = ye.unstable_setDisableYieldValue,
    fl = null,
    Ve = null;
  function sn(e) {
    if ((typeof Dv == "function" && zv(e), Ve && typeof Ve.setStrictMode == "function"))
      try {
        Ve.setStrictMode(fl, e);
      } catch {}
  }
  var Xe = Math.clz32 ? Math.clz32 : qv,
    jv = Math.log,
    Mv = Math.LN2;
  function qv(e) {
    return ((e >>>= 0), e === 0 ? 32 : (31 - ((jv(e) / Mv) | 0)) | 0);
  }
  var ql = 256,
    Ll = 262144,
    Hl = 4194304;
  function qn(e) {
    var t = e & 42;
    if (t !== 0) return t;
    switch (e & -e) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return e & 261888;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return e & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return e;
    }
  }
  function Ir(e, t, n) {
    var i = e.pendingLanes;
    if (i === 0) return 0;
    var a = 0,
      l = e.suspendedLanes,
      r = e.pingedLanes;
    e = e.warmLanes;
    var s = i & 134217727;
    return (
      s !== 0
        ? ((i = s & ~l),
          i !== 0 ? (a = qn(i)) : ((r &= s), r !== 0 ? (a = qn(r)) : n || ((n = s & ~e), n !== 0 && (a = qn(n)))))
        : ((s = i & ~l), s !== 0 ? (a = qn(s)) : r !== 0 ? (a = qn(r)) : n || ((n = i & ~e), n !== 0 && (a = qn(n)))),
      a === 0
        ? 0
        : t !== 0 &&
            t !== a &&
            (t & l) === 0 &&
            ((l = a & -a), (n = t & -t), l >= n || (l === 32 && (n & 4194048) !== 0))
          ? t
          : a
    );
  }
  function dl(e, t) {
    return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
  }
  function Lv(e, t) {
    switch (e) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return t + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function hh() {
    var e = Hl;
    return ((Hl <<= 1), (Hl & 62914560) === 0 && (Hl = 4194304), e);
  }
  function tu(e) {
    for (var t = [], n = 0; 31 > n; n++) t.push(e);
    return t;
  }
  function hl(e, t) {
    ((e.pendingLanes |= t), t !== 268435456 && ((e.suspendedLanes = 0), (e.pingedLanes = 0), (e.warmLanes = 0)));
  }
  function Hv(e, t, n, i, a, l) {
    var r = e.pendingLanes;
    ((e.pendingLanes = n),
      (e.suspendedLanes = 0),
      (e.pingedLanes = 0),
      (e.warmLanes = 0),
      (e.expiredLanes &= n),
      (e.entangledLanes &= n),
      (e.errorRecoveryDisabledLanes &= n),
      (e.shellSuspendCounter = 0));
    var s = e.entanglements,
      u = e.expirationTimes,
      o = e.hiddenUpdates;
    for (n = r & ~n; 0 < n;) {
      var f = 31 - Xe(n),
        m = 1 << f;
      ((s[f] = 0), (u[f] = -1));
      var d = o[f];
      if (d !== null)
        for (o[f] = null, f = 0; f < d.length; f++) {
          var g = d[f];
          g !== null && (g.lane &= -536870913);
        }
      n &= ~m;
    }
    (i !== 0 && gh(e, i, 0), l !== 0 && a === 0 && e.tag !== 0 && (e.suspendedLanes |= l & ~(r & ~t)));
  }
  function gh(e, t, n) {
    ((e.pendingLanes |= t), (e.suspendedLanes &= ~t));
    var i = 31 - Xe(t);
    ((e.entangledLanes |= t), (e.entanglements[i] = e.entanglements[i] | 1073741824 | (n & 261930)));
  }
  function yh(e, t) {
    var n = (e.entangledLanes |= t);
    for (e = e.entanglements; n;) {
      var i = 31 - Xe(n),
        a = 1 << i;
      ((a & t) | (e[i] & t) && (e[i] |= t), (n &= ~a));
    }
  }
  function mh(e, t) {
    var n = t & -t;
    return ((n = (n & 42) !== 0 ? 1 : ko(n)), (n & (e.suspendedLanes | t)) !== 0 ? 0 : n);
  }
  function ko(e) {
    switch (e) {
      case 2:
        e = 1;
        break;
      case 8:
        e = 4;
        break;
      case 32:
        e = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        e = 128;
        break;
      case 268435456:
        e = 134217728;
        break;
      default:
        e = 0;
    }
    return e;
  }
  function Co(e) {
    return ((e &= -e), 2 < e ? (8 < e ? ((e & 134217727) !== 0 ? 32 : 268435456) : 8) : 2);
  }
  function vh() {
    var e = B.p;
    return e !== 0 ? e : ((e = window.event), e === void 0 ? 32 : By(e.type));
  }
  function Mf(e, t) {
    var n = B.p;
    try {
      return ((B.p = e), t());
    } finally {
      B.p = n;
    }
  }
  var Rn = Math.random().toString(36).slice(2),
    we = "__reactFiber$" + Rn,
    Le = "__reactProps$" + Rn,
    na = "__reactContainer$" + Rn,
    Lu = "__reactEvents$" + Rn,
    Bv = "__reactListeners$" + Rn,
    Gv = "__reactHandles$" + Rn,
    qf = "__reactResources$" + Rn,
    gl = "__reactMarker$" + Rn;
  function Uo(e) {
    (delete e[we], delete e[Le], delete e[Lu], delete e[Bv], delete e[Gv]);
  }
  function xi(e) {
    var t = e[we];
    if (t) return t;
    for (var n = e.parentNode; n;) {
      if ((t = n[na] || n[we])) {
        if (((n = t.alternate), t.child !== null || (n !== null && n.child !== null)))
          for (e = Vd(e); e !== null;) {
            if ((n = e[we])) return n;
            e = Vd(e);
          }
        return t;
      }
      ((e = n), (n = e.parentNode));
    }
    return null;
  }
  function ia(e) {
    if ((e = e[we] || e[na])) {
      var t = e.tag;
      if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return e;
    }
    return null;
  }
  function za(e) {
    var t = e.tag;
    if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
    throw Error(p(33));
  }
  function Li(e) {
    var t = e[qf];
    return (t || (t = e[qf] = { hoistableStyles: new Map(), hoistableScripts: new Map() }), t);
  }
  function ve(e) {
    e[gl] = !0;
  }
  var ph = new Set(),
    _h = {};
  function $n(e, t) {
    (Xi(e, t), Xi(e + "Capture", t));
  }
  function Xi(e, t) {
    for (_h[e] = t, e = 0; e < t.length; e++) ph.add(t[e]);
  }
  var Kv = RegExp(
      "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$",
    ),
    Lf = {},
    Hf = {};
  function Yv(e) {
    return qu.call(Hf, e) ? !0 : qu.call(Lf, e) ? !1 : Kv.test(e) ? (Hf[e] = !0) : ((Lf[e] = !0), !1);
  }
  function er(e, t, n) {
    if (Yv(t))
      if (n === null) e.removeAttribute(t);
      else {
        switch (typeof n) {
          case "undefined":
          case "function":
          case "symbol":
            e.removeAttribute(t);
            return;
          case "boolean":
            var i = t.toLowerCase().slice(0, 5);
            if (i !== "data-" && i !== "aria-") {
              e.removeAttribute(t);
              return;
            }
        }
        e.setAttribute(t, "" + n);
      }
  }
  function Bl(e, t, n) {
    if (n === null) e.removeAttribute(t);
    else {
      switch (typeof n) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(t);
          return;
      }
      e.setAttribute(t, "" + n);
    }
  }
  function kt(e, t, n, i) {
    if (i === null) e.removeAttribute(n);
    else {
      switch (typeof i) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          e.removeAttribute(n);
          return;
      }
      e.setAttributeNS(t, n, "" + i);
    }
  }
  function et(e) {
    switch (typeof e) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return e;
      case "object":
        return e;
      default:
        return "";
    }
  }
  function bh(e) {
    var t = e.type;
    return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
  }
  function Iv(e, t, n) {
    var i = Object.getOwnPropertyDescriptor(e.constructor.prototype, t);
    if (!e.hasOwnProperty(t) && typeof i < "u" && typeof i.get == "function" && typeof i.set == "function") {
      var a = i.get,
        l = i.set;
      return (
        Object.defineProperty(e, t, {
          configurable: !0,
          get: function () {
            return a.call(this);
          },
          set: function (r) {
            ((n = "" + r), l.call(this, r));
          },
        }),
        Object.defineProperty(e, t, { enumerable: i.enumerable }),
        {
          getValue: function () {
            return n;
          },
          setValue: function (r) {
            n = "" + r;
          },
          stopTracking: function () {
            ((e._valueTracker = null), delete e[t]);
          },
        }
      );
    }
  }
  function Hu(e) {
    if (!e._valueTracker) {
      var t = bh(e) ? "checked" : "value";
      e._valueTracker = Iv(e, t, "" + e[t]);
    }
  }
  function wh(e) {
    if (!e) return !1;
    var t = e._valueTracker;
    if (!t) return !0;
    var n = t.getValue(),
      i = "";
    return (e && (i = bh(e) ? (e.checked ? "true" : "false") : e.value), (e = i), e !== n ? (t.setValue(e), !0) : !1);
  }
  function _r(e) {
    if (((e = e || (typeof document < "u" ? document : void 0)), typeof e > "u")) return null;
    try {
      return e.activeElement || e.body;
    } catch {
      return e.body;
    }
  }
  var Vv = /[\n"\\]/g;
  function it(e) {
    return e.replace(Vv, function (t) {
      return "\\" + t.charCodeAt(0).toString(16) + " ";
    });
  }
  function Bu(e, t, n, i, a, l, r, s) {
    ((e.name = ""),
      r != null && typeof r != "function" && typeof r != "symbol" && typeof r != "boolean"
        ? (e.type = r)
        : e.removeAttribute("type"),
      t != null
        ? r === "number"
          ? ((t === 0 && e.value === "") || e.value != t) && (e.value = "" + et(t))
          : e.value !== "" + et(t) && (e.value = "" + et(t))
        : (r !== "submit" && r !== "reset") || e.removeAttribute("value"),
      t != null ? Gu(e, r, et(t)) : n != null ? Gu(e, r, et(n)) : i != null && e.removeAttribute("value"),
      a == null && l != null && (e.defaultChecked = !!l),
      a != null && (e.checked = a && typeof a != "function" && typeof a != "symbol"),
      s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean"
        ? (e.name = "" + et(s))
        : e.removeAttribute("name"));
  }
  function Sh(e, t, n, i, a, l, r, s) {
    if (
      (l != null && typeof l != "function" && typeof l != "symbol" && typeof l != "boolean" && (e.type = l),
      t != null || n != null)
    ) {
      if (!((l !== "submit" && l !== "reset") || t != null)) {
        Hu(e);
        return;
      }
      ((n = n != null ? "" + et(n) : ""),
        (t = t != null ? "" + et(t) : n),
        s || t === e.value || (e.value = t),
        (e.defaultValue = t));
    }
    ((i = i ?? a),
      (i = typeof i != "function" && typeof i != "symbol" && !!i),
      (e.checked = s ? e.checked : !!i),
      (e.defaultChecked = !!i),
      r != null && typeof r != "function" && typeof r != "symbol" && typeof r != "boolean" && (e.name = r),
      Hu(e));
  }
  function Gu(e, t, n) {
    (t === "number" && _r(e.ownerDocument) === e) || e.defaultValue === "" + n || (e.defaultValue = "" + n);
  }
  function Hi(e, t, n, i) {
    if (((e = e.options), t)) {
      t = {};
      for (var a = 0; a < n.length; a++) t["$" + n[a]] = !0;
      for (n = 0; n < e.length; n++)
        ((a = t.hasOwnProperty("$" + e[n].value)),
          e[n].selected !== a && (e[n].selected = a),
          a && i && (e[n].defaultSelected = !0));
    } else {
      for (n = "" + et(n), t = null, a = 0; a < e.length; a++) {
        if (e[a].value === n) {
          ((e[a].selected = !0), i && (e[a].defaultSelected = !0));
          return;
        }
        t !== null || e[a].disabled || (t = e[a]);
      }
      t !== null && (t.selected = !0);
    }
  }
  function Eh(e, t, n) {
    if (t != null && ((t = "" + et(t)), t !== e.value && (e.value = t), n == null)) {
      e.defaultValue !== t && (e.defaultValue = t);
      return;
    }
    e.defaultValue = n != null ? "" + et(n) : "";
  }
  function Ah(e, t, n, i) {
    if (t == null) {
      if (i != null) {
        if (n != null) throw Error(p(92));
        if (Da(i)) {
          if (1 < i.length) throw Error(p(93));
          i = i[0];
        }
        n = i;
      }
      (n == null && (n = ""), (t = n));
    }
    ((n = et(t)), (e.defaultValue = n), (i = e.textContent), i === n && i !== "" && i !== null && (e.value = i), Hu(e));
  }
  function Qi(e, t) {
    if (t) {
      var n = e.firstChild;
      if (n && n === e.lastChild && n.nodeType === 3) {
        n.nodeValue = t;
        return;
      }
    }
    e.textContent = t;
  }
  var Xv = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " ",
    ),
  );
  function Bf(e, t, n) {
    var i = t.indexOf("--") === 0;
    n == null || typeof n == "boolean" || n === ""
      ? i
        ? e.setProperty(t, "")
        : t === "float"
          ? (e.cssFloat = "")
          : (e[t] = "")
      : i
        ? e.setProperty(t, n)
        : typeof n != "number" || n === 0 || Xv.has(t)
          ? t === "float"
            ? (e.cssFloat = n)
            : (e[t] = ("" + n).trim())
          : (e[t] = n + "px");
  }
  function Rh(e, t, n) {
    if (t != null && typeof t != "object") throw Error(p(62));
    if (((e = e.style), n != null)) {
      for (var i in n)
        !n.hasOwnProperty(i) ||
          (t != null && t.hasOwnProperty(i)) ||
          (i.indexOf("--") === 0 ? e.setProperty(i, "") : i === "float" ? (e.cssFloat = "") : (e[i] = ""));
      for (var a in t) ((i = t[a]), t.hasOwnProperty(a) && n[a] !== i && Bf(e, a, i));
    } else for (var l in t) t.hasOwnProperty(l) && Bf(e, l, t[l]);
  }
  function No(e) {
    if (e.indexOf("-") === -1) return !1;
    switch (e) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var Qv = new Map([
      ["acceptCharset", "accept-charset"],
      ["htmlFor", "for"],
      ["httpEquiv", "http-equiv"],
      ["crossOrigin", "crossorigin"],
      ["accentHeight", "accent-height"],
      ["alignmentBaseline", "alignment-baseline"],
      ["arabicForm", "arabic-form"],
      ["baselineShift", "baseline-shift"],
      ["capHeight", "cap-height"],
      ["clipPath", "clip-path"],
      ["clipRule", "clip-rule"],
      ["colorInterpolation", "color-interpolation"],
      ["colorInterpolationFilters", "color-interpolation-filters"],
      ["colorProfile", "color-profile"],
      ["colorRendering", "color-rendering"],
      ["dominantBaseline", "dominant-baseline"],
      ["enableBackground", "enable-background"],
      ["fillOpacity", "fill-opacity"],
      ["fillRule", "fill-rule"],
      ["floodColor", "flood-color"],
      ["floodOpacity", "flood-opacity"],
      ["fontFamily", "font-family"],
      ["fontSize", "font-size"],
      ["fontSizeAdjust", "font-size-adjust"],
      ["fontStretch", "font-stretch"],
      ["fontStyle", "font-style"],
      ["fontVariant", "font-variant"],
      ["fontWeight", "font-weight"],
      ["glyphName", "glyph-name"],
      ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
      ["glyphOrientationVertical", "glyph-orientation-vertical"],
      ["horizAdvX", "horiz-adv-x"],
      ["horizOriginX", "horiz-origin-x"],
      ["imageRendering", "image-rendering"],
      ["letterSpacing", "letter-spacing"],
      ["lightingColor", "lighting-color"],
      ["markerEnd", "marker-end"],
      ["markerMid", "marker-mid"],
      ["markerStart", "marker-start"],
      ["overlinePosition", "overline-position"],
      ["overlineThickness", "overline-thickness"],
      ["paintOrder", "paint-order"],
      ["panose-1", "panose-1"],
      ["pointerEvents", "pointer-events"],
      ["renderingIntent", "rendering-intent"],
      ["shapeRendering", "shape-rendering"],
      ["stopColor", "stop-color"],
      ["stopOpacity", "stop-opacity"],
      ["strikethroughPosition", "strikethrough-position"],
      ["strikethroughThickness", "strikethrough-thickness"],
      ["strokeDasharray", "stroke-dasharray"],
      ["strokeDashoffset", "stroke-dashoffset"],
      ["strokeLinecap", "stroke-linecap"],
      ["strokeLinejoin", "stroke-linejoin"],
      ["strokeMiterlimit", "stroke-miterlimit"],
      ["strokeOpacity", "stroke-opacity"],
      ["strokeWidth", "stroke-width"],
      ["textAnchor", "text-anchor"],
      ["textDecoration", "text-decoration"],
      ["textRendering", "text-rendering"],
      ["transformOrigin", "transform-origin"],
      ["underlinePosition", "underline-position"],
      ["underlineThickness", "underline-thickness"],
      ["unicodeBidi", "unicode-bidi"],
      ["unicodeRange", "unicode-range"],
      ["unitsPerEm", "units-per-em"],
      ["vAlphabetic", "v-alphabetic"],
      ["vHanging", "v-hanging"],
      ["vIdeographic", "v-ideographic"],
      ["vMathematical", "v-mathematical"],
      ["vectorEffect", "vector-effect"],
      ["vertAdvY", "vert-adv-y"],
      ["vertOriginX", "vert-origin-x"],
      ["vertOriginY", "vert-origin-y"],
      ["wordSpacing", "word-spacing"],
      ["writingMode", "writing-mode"],
      ["xmlnsXlink", "xmlns:xlink"],
      ["xHeight", "x-height"],
    ]),
    Jv =
      /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function tr(e) {
    return Jv.test("" + e)
      ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
      : e;
  }
  function qt() {}
  var Ku = null;
  function Do(e) {
    return (
      (e = e.target || e.srcElement || window),
      e.correspondingUseElement && (e = e.correspondingUseElement),
      e.nodeType === 3 ? e.parentNode : e
    );
  }
  var ki = null,
    Bi = null;
  function Gf(e) {
    var t = ia(e);
    if (t && (e = t.stateNode)) {
      var n = e[Le] || null;
      e: switch (((e = t.stateNode), t.type)) {
        case "input":
          if (
            (Bu(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name),
            (t = n.name),
            n.type === "radio" && t != null)
          ) {
            for (n = e; n.parentNode;) n = n.parentNode;
            for (n = n.querySelectorAll('input[name="' + it("" + t) + '"][type="radio"]'), t = 0; t < n.length; t++) {
              var i = n[t];
              if (i !== e && i.form === e.form) {
                var a = i[Le] || null;
                if (!a) throw Error(p(90));
                Bu(i, a.value, a.defaultValue, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name);
              }
            }
            for (t = 0; t < n.length; t++) ((i = n[t]), i.form === e.form && wh(i));
          }
          break e;
        case "textarea":
          Eh(e, n.value, n.defaultValue);
          break e;
        case "select":
          ((t = n.value), t != null && Hi(e, !!n.multiple, t, !1));
      }
    }
  }
  var nu = !1;
  function Th(e, t, n) {
    if (nu) return e(t, n);
    nu = !0;
    try {
      var i = e(t);
      return i;
    } finally {
      if (((nu = !1), (ki !== null || Bi !== null) && (ns(), ki && ((t = ki), (e = Bi), (Bi = ki = null), Gf(t), e))))
        for (t = 0; t < e.length; t++) Gf(e[t]);
    }
  }
  function Wa(e, t) {
    var n = e.stateNode;
    if (n === null) return null;
    var i = n[Le] || null;
    if (i === null) return null;
    n = i[t];
    e: switch (t) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        ((i = !i.disabled) ||
          ((e = e.type), (i = !(e === "button" || e === "input" || e === "select" || e === "textarea"))),
          (e = !i));
        break e;
      default:
        e = !1;
    }
    if (e) return null;
    if (n && typeof n != "function") throw Error(p(231, t, typeof n));
    return n;
  }
  var Kt = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"),
    Yu = !1;
  if (Kt)
    try {
      ((wi = {}),
        Object.defineProperty(wi, "passive", {
          get: function () {
            Yu = !0;
          },
        }),
        window.addEventListener("test", wi, wi),
        window.removeEventListener("test", wi, wi));
    } catch {
      Yu = !1;
    }
  var wi,
    un = null,
    zo = null,
    nr = null;
  function Oh() {
    if (nr) return nr;
    var e,
      t = zo,
      n = t.length,
      i,
      a = "value" in un ? un.value : un.textContent,
      l = a.length;
    for (e = 0; e < n && t[e] === a[e]; e++);
    var r = n - e;
    for (i = 1; i <= r && t[n - i] === a[l - i]; i++);
    return (nr = a.slice(e, 1 < i ? 1 - i : void 0));
  }
  function ir(e) {
    var t = e.keyCode;
    return (
      "charCode" in e ? ((e = e.charCode), e === 0 && t === 13 && (e = 13)) : (e = t),
      e === 10 && (e = 13),
      32 <= e || e === 13 ? e : 0
    );
  }
  function Gl() {
    return !0;
  }
  function Kf() {
    return !1;
  }
  function He(e) {
    function t(n, i, a, l, r) {
      ((this._reactName = n),
        (this._targetInst = a),
        (this.type = i),
        (this.nativeEvent = l),
        (this.target = r),
        (this.currentTarget = null));
      for (var s in e) e.hasOwnProperty(s) && ((n = e[s]), (this[s] = n ? n(l) : l[s]));
      return (
        (this.isDefaultPrevented = (l.defaultPrevented != null ? l.defaultPrevented : l.returnValue === !1) ? Gl : Kf),
        (this.isPropagationStopped = Kf),
        this
      );
    }
    return (
      $(t.prototype, {
        preventDefault: function () {
          this.defaultPrevented = !0;
          var n = this.nativeEvent;
          n &&
            (n.preventDefault ? n.preventDefault() : typeof n.returnValue != "unknown" && (n.returnValue = !1),
            (this.isDefaultPrevented = Gl));
        },
        stopPropagation: function () {
          var n = this.nativeEvent;
          n &&
            (n.stopPropagation ? n.stopPropagation() : typeof n.cancelBubble != "unknown" && (n.cancelBubble = !0),
            (this.isPropagationStopped = Gl));
        },
        persist: function () {},
        isPersistent: Gl,
      }),
      t
    );
  }
  var Wn = {
      eventPhase: 0,
      bubbles: 0,
      cancelable: 0,
      timeStamp: function (e) {
        return e.timeStamp || Date.now();
      },
      defaultPrevented: 0,
      isTrusted: 0,
    },
    Vr = He(Wn),
    yl = $({}, Wn, { view: 0, detail: 0 }),
    Zv = He(yl),
    iu,
    au,
    Ta,
    Xr = $({}, yl, {
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      getModifierState: jo,
      button: 0,
      buttons: 0,
      relatedTarget: function (e) {
        return e.relatedTarget === void 0
          ? e.fromElement === e.srcElement
            ? e.toElement
            : e.fromElement
          : e.relatedTarget;
      },
      movementX: function (e) {
        return "movementX" in e
          ? e.movementX
          : (e !== Ta &&
              (Ta && e.type === "mousemove"
                ? ((iu = e.screenX - Ta.screenX), (au = e.screenY - Ta.screenY))
                : (au = iu = 0),
              (Ta = e)),
            iu);
      },
      movementY: function (e) {
        return "movementY" in e ? e.movementY : au;
      },
    }),
    Yf = He(Xr),
    $v = $({}, Xr, { dataTransfer: 0 }),
    Wv = He($v),
    Fv = $({}, yl, { relatedTarget: 0 }),
    lu = He(Fv),
    Pv = $({}, Wn, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
    ep = He(Pv),
    tp = $({}, Wn, {
      clipboardData: function (e) {
        return "clipboardData" in e ? e.clipboardData : window.clipboardData;
      },
    }),
    np = He(tp),
    ip = $({}, Wn, { data: 0 }),
    If = He(ip),
    ap = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified",
    },
    lp = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta",
    },
    rp = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
  function sp(e) {
    var t = this.nativeEvent;
    return t.getModifierState ? t.getModifierState(e) : (e = rp[e]) ? !!t[e] : !1;
  }
  function jo() {
    return sp;
  }
  var up = $({}, yl, {
      key: function (e) {
        if (e.key) {
          var t = ap[e.key] || e.key;
          if (t !== "Unidentified") return t;
        }
        return e.type === "keypress"
          ? ((e = ir(e)), e === 13 ? "Enter" : String.fromCharCode(e))
          : e.type === "keydown" || e.type === "keyup"
            ? lp[e.keyCode] || "Unidentified"
            : "";
      },
      code: 0,
      location: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      repeat: 0,
      locale: 0,
      getModifierState: jo,
      charCode: function (e) {
        return e.type === "keypress" ? ir(e) : 0;
      },
      keyCode: function (e) {
        return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
      },
      which: function (e) {
        return e.type === "keypress" ? ir(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
      },
    }),
    op = He(up),
    cp = $({}, Xr, {
      pointerId: 0,
      width: 0,
      height: 0,
      pressure: 0,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: 0,
      isPrimary: 0,
    }),
    Vf = He(cp),
    fp = $({}, yl, {
      touches: 0,
      targetTouches: 0,
      changedTouches: 0,
      altKey: 0,
      metaKey: 0,
      ctrlKey: 0,
      shiftKey: 0,
      getModifierState: jo,
    }),
    dp = He(fp),
    hp = $({}, Wn, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
    gp = He(hp),
    yp = $({}, Xr, {
      deltaX: function (e) {
        return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
      },
      deltaY: function (e) {
        return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
      },
      deltaZ: 0,
      deltaMode: 0,
    }),
    mp = He(yp),
    vp = $({}, Wn, { newState: 0, oldState: 0 }),
    pp = He(vp),
    _p = [9, 13, 27, 32],
    Mo = Kt && "CompositionEvent" in window,
    qa = null;
  Kt && "documentMode" in document && (qa = document.documentMode);
  var bp = Kt && "TextEvent" in window && !qa,
    xh = Kt && (!Mo || (qa && 8 < qa && 11 >= qa)),
    Xf = " ",
    Qf = !1;
  function kh(e, t) {
    switch (e) {
      case "keyup":
        return _p.indexOf(t.keyCode) !== -1;
      case "keydown":
        return t.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function Ch(e) {
    return ((e = e.detail), typeof e == "object" && "data" in e ? e.data : null);
  }
  var Ci = !1;
  function wp(e, t) {
    switch (e) {
      case "compositionend":
        return Ch(t);
      case "keypress":
        return t.which !== 32 ? null : ((Qf = !0), Xf);
      case "textInput":
        return ((e = t.data), e === Xf && Qf ? null : e);
      default:
        return null;
    }
  }
  function Sp(e, t) {
    if (Ci)
      return e === "compositionend" || (!Mo && kh(e, t)) ? ((e = Oh()), (nr = zo = un = null), (Ci = !1), e) : null;
    switch (e) {
      case "paste":
        return null;
      case "keypress":
        if (!(t.ctrlKey || t.altKey || t.metaKey) || (t.ctrlKey && t.altKey)) {
          if (t.char && 1 < t.char.length) return t.char;
          if (t.which) return String.fromCharCode(t.which);
        }
        return null;
      case "compositionend":
        return xh && t.locale !== "ko" ? null : t.data;
      default:
        return null;
    }
  }
  var Ep = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0,
  };
  function Jf(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return t === "input" ? !!Ep[e.type] : t === "textarea";
  }
  function Uh(e, t, n, i) {
    (ki ? (Bi ? Bi.push(i) : (Bi = [i])) : (ki = i),
      (t = qr(t, "onChange")),
      0 < t.length && ((n = new Vr("onChange", "change", null, n, i)), e.push({ event: n, listeners: t })));
  }
  var La = null,
    Fa = null;
  function Ap(e) {
    Ty(e, 0);
  }
  function Qr(e) {
    var t = za(e);
    if (wh(t)) return e;
  }
  function Zf(e, t) {
    if (e === "change") return t;
  }
  var Nh = !1;
  Kt &&
    (Kt
      ? ((Yl = "oninput" in document),
        Yl ||
          ((ru = document.createElement("div")),
          ru.setAttribute("oninput", "return;"),
          (Yl = typeof ru.oninput == "function")),
        (Kl = Yl))
      : (Kl = !1),
    (Nh = Kl && (!document.documentMode || 9 < document.documentMode)));
  var Kl, Yl, ru;
  function $f() {
    La && (La.detachEvent("onpropertychange", Dh), (Fa = La = null));
  }
  function Dh(e) {
    if (e.propertyName === "value" && Qr(Fa)) {
      var t = [];
      (Uh(t, Fa, e, Do(e)), Th(Ap, t));
    }
  }
  function Rp(e, t, n) {
    e === "focusin" ? ($f(), (La = t), (Fa = n), La.attachEvent("onpropertychange", Dh)) : e === "focusout" && $f();
  }
  function Tp(e) {
    if (e === "selectionchange" || e === "keyup" || e === "keydown") return Qr(Fa);
  }
  function Op(e, t) {
    if (e === "click") return Qr(t);
  }
  function xp(e, t) {
    if (e === "input" || e === "change") return Qr(t);
  }
  function kp(e, t) {
    return (e === t && (e !== 0 || 1 / e === 1 / t)) || (e !== e && t !== t);
  }
  var Je = typeof Object.is == "function" ? Object.is : kp;
  function Pa(e, t) {
    if (Je(e, t)) return !0;
    if (typeof e != "object" || e === null || typeof t != "object" || t === null) return !1;
    var n = Object.keys(e),
      i = Object.keys(t);
    if (n.length !== i.length) return !1;
    for (i = 0; i < n.length; i++) {
      var a = n[i];
      if (!qu.call(t, a) || !Je(e[a], t[a])) return !1;
    }
    return !0;
  }
  function Wf(e) {
    for (; e && e.firstChild;) e = e.firstChild;
    return e;
  }
  function Ff(e, t) {
    var n = Wf(e);
    e = 0;
    for (var i; n;) {
      if (n.nodeType === 3) {
        if (((i = e + n.textContent.length), e <= t && i >= t)) return { node: n, offset: t - e };
        e = i;
      }
      e: {
        for (; n;) {
          if (n.nextSibling) {
            n = n.nextSibling;
            break e;
          }
          n = n.parentNode;
        }
        n = void 0;
      }
      n = Wf(n);
    }
  }
  function zh(e, t) {
    return e && t
      ? e === t
        ? !0
        : e && e.nodeType === 3
          ? !1
          : t && t.nodeType === 3
            ? zh(e, t.parentNode)
            : "contains" in e
              ? e.contains(t)
              : e.compareDocumentPosition
                ? !!(e.compareDocumentPosition(t) & 16)
                : !1
      : !1;
  }
  function jh(e) {
    e =
      e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null
        ? e.ownerDocument.defaultView
        : window;
    for (var t = _r(e.document); t instanceof e.HTMLIFrameElement;) {
      try {
        var n = typeof t.contentWindow.location.href == "string";
      } catch {
        n = !1;
      }
      if (n) e = t.contentWindow;
      else break;
      t = _r(e.document);
    }
    return t;
  }
  function qo(e) {
    var t = e && e.nodeName && e.nodeName.toLowerCase();
    return (
      t &&
      ((t === "input" &&
        (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password")) ||
        t === "textarea" ||
        e.contentEditable === "true")
    );
  }
  var Cp = Kt && "documentMode" in document && 11 >= document.documentMode,
    Ui = null,
    Iu = null,
    Ha = null,
    Vu = !1;
  function Pf(e, t, n) {
    var i = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
    Vu ||
      Ui == null ||
      Ui !== _r(i) ||
      ((i = Ui),
      "selectionStart" in i && qo(i)
        ? (i = { start: i.selectionStart, end: i.selectionEnd })
        : ((i = ((i.ownerDocument && i.ownerDocument.defaultView) || window).getSelection()),
          (i = {
            anchorNode: i.anchorNode,
            anchorOffset: i.anchorOffset,
            focusNode: i.focusNode,
            focusOffset: i.focusOffset,
          })),
      (Ha && Pa(Ha, i)) ||
        ((Ha = i),
        (i = qr(Iu, "onSelect")),
        0 < i.length &&
          ((t = new Vr("onSelect", "select", null, t, n)), e.push({ event: t, listeners: i }), (t.target = Ui))));
  }
  function jn(e, t) {
    var n = {};
    return ((n[e.toLowerCase()] = t.toLowerCase()), (n["Webkit" + e] = "webkit" + t), (n["Moz" + e] = "moz" + t), n);
  }
  var Ni = {
      animationend: jn("Animation", "AnimationEnd"),
      animationiteration: jn("Animation", "AnimationIteration"),
      animationstart: jn("Animation", "AnimationStart"),
      transitionrun: jn("Transition", "TransitionRun"),
      transitionstart: jn("Transition", "TransitionStart"),
      transitioncancel: jn("Transition", "TransitionCancel"),
      transitionend: jn("Transition", "TransitionEnd"),
    },
    su = {},
    Mh = {};
  Kt &&
    ((Mh = document.createElement("div").style),
    "AnimationEvent" in window ||
      (delete Ni.animationend.animation, delete Ni.animationiteration.animation, delete Ni.animationstart.animation),
    "TransitionEvent" in window || delete Ni.transitionend.transition);
  function Fn(e) {
    if (su[e]) return su[e];
    if (!Ni[e]) return e;
    var t = Ni[e],
      n;
    for (n in t) if (t.hasOwnProperty(n) && n in Mh) return (su[e] = t[n]);
    return e;
  }
  var qh = Fn("animationend"),
    Lh = Fn("animationiteration"),
    Hh = Fn("animationstart"),
    Up = Fn("transitionrun"),
    Np = Fn("transitionstart"),
    Dp = Fn("transitioncancel"),
    Bh = Fn("transitionend"),
    Gh = new Map(),
    Xu =
      "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
        " ",
      );
  Xu.push("scrollEnd");
  function yt(e, t) {
    (Gh.set(e, t), $n(t, [e]));
  }
  var br =
      typeof reportError == "function"
        ? reportError
        : function (e) {
            if (typeof window == "object" && typeof window.ErrorEvent == "function") {
              var t = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  typeof e == "object" && e !== null && typeof e.message == "string" ? String(e.message) : String(e),
                error: e,
              });
              if (!window.dispatchEvent(t)) return;
            } else if (typeof process == "object" && typeof process.emit == "function") {
              process.emit("uncaughtException", e);
              return;
            }
            console.error(e);
          },
    Pe = [],
    Di = 0,
    Lo = 0;
  function Jr() {
    for (var e = Di, t = (Lo = Di = 0); t < e;) {
      var n = Pe[t];
      Pe[t++] = null;
      var i = Pe[t];
      Pe[t++] = null;
      var a = Pe[t];
      Pe[t++] = null;
      var l = Pe[t];
      if (((Pe[t++] = null), i !== null && a !== null)) {
        var r = i.pending;
        (r === null ? (a.next = a) : ((a.next = r.next), (r.next = a)), (i.pending = a));
      }
      l !== 0 && Kh(n, a, l);
    }
  }
  function Zr(e, t, n, i) {
    ((Pe[Di++] = e),
      (Pe[Di++] = t),
      (Pe[Di++] = n),
      (Pe[Di++] = i),
      (Lo |= i),
      (e.lanes |= i),
      (e = e.alternate),
      e !== null && (e.lanes |= i));
  }
  function Ho(e, t, n, i) {
    return (Zr(e, t, n, i), wr(e));
  }
  function Pn(e, t) {
    return (Zr(e, null, null, t), wr(e));
  }
  function Kh(e, t, n) {
    e.lanes |= n;
    var i = e.alternate;
    i !== null && (i.lanes |= n);
    for (var a = !1, l = e.return; l !== null;)
      ((l.childLanes |= n),
        (i = l.alternate),
        i !== null && (i.childLanes |= n),
        l.tag === 22 && ((e = l.stateNode), e === null || e._visibility & 1 || (a = !0)),
        (e = l),
        (l = l.return));
    return e.tag === 3
      ? ((l = e.stateNode),
        a &&
          t !== null &&
          ((a = 31 - Xe(n)),
          (e = l.hiddenUpdates),
          (i = e[a]),
          i === null ? (e[a] = [t]) : i.push(t),
          (t.lane = n | 536870912)),
        l)
      : null;
  }
  function wr(e) {
    if (50 < Ja) throw ((Ja = 0), (go = null), Error(p(185)));
    for (var t = e.return; t !== null;) ((e = t), (t = e.return));
    return e.tag === 3 ? e.stateNode : null;
  }
  var zi = {};
  function zp(e, t, n, i) {
    ((this.tag = e),
      (this.key = n),
      (this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null),
      (this.index = 0),
      (this.refCleanup = this.ref = null),
      (this.pendingProps = t),
      (this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null),
      (this.mode = i),
      (this.subtreeFlags = this.flags = 0),
      (this.deletions = null),
      (this.childLanes = this.lanes = 0),
      (this.alternate = null));
  }
  function Ke(e, t, n, i) {
    return new zp(e, t, n, i);
  }
  function Bo(e) {
    return ((e = e.prototype), !(!e || !e.isReactComponent));
  }
  function Ht(e, t) {
    var n = e.alternate;
    return (
      n === null
        ? ((n = Ke(e.tag, t, e.key, e.mode)),
          (n.elementType = e.elementType),
          (n.type = e.type),
          (n.stateNode = e.stateNode),
          (n.alternate = e),
          (e.alternate = n))
        : ((n.pendingProps = t), (n.type = e.type), (n.flags = 0), (n.subtreeFlags = 0), (n.deletions = null)),
      (n.flags = e.flags & 65011712),
      (n.childLanes = e.childLanes),
      (n.lanes = e.lanes),
      (n.child = e.child),
      (n.memoizedProps = e.memoizedProps),
      (n.memoizedState = e.memoizedState),
      (n.updateQueue = e.updateQueue),
      (t = e.dependencies),
      (n.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }),
      (n.sibling = e.sibling),
      (n.index = e.index),
      (n.ref = e.ref),
      (n.refCleanup = e.refCleanup),
      n
    );
  }
  function Yh(e, t) {
    e.flags &= 65011714;
    var n = e.alternate;
    return (
      n === null
        ? ((e.childLanes = 0),
          (e.lanes = t),
          (e.child = null),
          (e.subtreeFlags = 0),
          (e.memoizedProps = null),
          (e.memoizedState = null),
          (e.updateQueue = null),
          (e.dependencies = null),
          (e.stateNode = null))
        : ((e.childLanes = n.childLanes),
          (e.lanes = n.lanes),
          (e.child = n.child),
          (e.subtreeFlags = 0),
          (e.deletions = null),
          (e.memoizedProps = n.memoizedProps),
          (e.memoizedState = n.memoizedState),
          (e.updateQueue = n.updateQueue),
          (e.type = n.type),
          (t = n.dependencies),
          (e.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext })),
      e
    );
  }
  function ar(e, t, n, i, a, l) {
    var r = 0;
    if (((i = e), typeof e == "function")) Bo(e) && (r = 1);
    else if (typeof e == "string")
      r = q0(e, n, wt.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
    else
      e: switch (e) {
        case Du:
          return ((e = Ke(31, n, t, a)), (e.elementType = Du), (e.lanes = l), e);
        case Ti:
          return Gn(n.children, a, l, t);
        case uh:
          ((r = 8), (a |= 24));
          break;
        case Cu:
          return ((e = Ke(12, n, t, a | 2)), (e.elementType = Cu), (e.lanes = l), e);
        case Uu:
          return ((e = Ke(13, n, t, a)), (e.elementType = Uu), (e.lanes = l), e);
        case Nu:
          return ((e = Ke(19, n, t, a)), (e.elementType = Nu), (e.lanes = l), e);
        default:
          if (typeof e == "object" && e !== null)
            switch (e.$$typeof) {
              case Mt:
                r = 10;
                break e;
              case oh:
                r = 9;
                break e;
              case To:
                r = 11;
                break e;
              case Oo:
                r = 14;
                break e;
              case en:
                ((r = 16), (i = null));
                break e;
            }
          ((r = 29), (n = Error(p(130, e === null ? "null" : typeof e, ""))), (i = null));
      }
    return ((t = Ke(r, n, t, a)), (t.elementType = e), (t.type = i), (t.lanes = l), t);
  }
  function Gn(e, t, n, i) {
    return ((e = Ke(7, e, i, t)), (e.lanes = n), e);
  }
  function uu(e, t, n) {
    return ((e = Ke(6, e, null, t)), (e.lanes = n), e);
  }
  function Ih(e) {
    var t = Ke(18, null, null, 0);
    return ((t.stateNode = e), t);
  }
  function ou(e, t, n) {
    return (
      (t = Ke(4, e.children !== null ? e.children : [], e.key, t)),
      (t.lanes = n),
      (t.stateNode = { containerInfo: e.containerInfo, pendingChildren: null, implementation: e.implementation }),
      t
    );
  }
  var ed = new WeakMap();
  function at(e, t) {
    if (typeof e == "object" && e !== null) {
      var n = ed.get(e);
      return n !== void 0 ? n : ((t = { value: e, source: t, stack: jf(t) }), ed.set(e, t), t);
    }
    return { value: e, source: t, stack: jf(t) };
  }
  var ji = [],
    Mi = 0,
    Sr = null,
    el = 0,
    tt = [],
    nt = 0,
    wn = null,
    pt = 1,
    _t = "";
  function zt(e, t) {
    ((ji[Mi++] = el), (ji[Mi++] = Sr), (Sr = e), (el = t));
  }
  function Vh(e, t, n) {
    ((tt[nt++] = pt), (tt[nt++] = _t), (tt[nt++] = wn), (wn = e));
    var i = pt;
    e = _t;
    var a = 32 - Xe(i) - 1;
    ((i &= ~(1 << a)), (n += 1));
    var l = 32 - Xe(t) + a;
    if (30 < l) {
      var r = a - (a % 5);
      ((l = (i & ((1 << r) - 1)).toString(32)),
        (i >>= r),
        (a -= r),
        (pt = (1 << (32 - Xe(t) + a)) | (n << a) | i),
        (_t = l + e));
    } else ((pt = (1 << l) | (n << a) | i), (_t = e));
  }
  function Go(e) {
    e.return !== null && (zt(e, 1), Vh(e, 1, 0));
  }
  function Ko(e) {
    for (; e === Sr;) ((Sr = ji[--Mi]), (ji[Mi] = null), (el = ji[--Mi]), (ji[Mi] = null));
    for (; e === wn;)
      ((wn = tt[--nt]), (tt[nt] = null), (_t = tt[--nt]), (tt[nt] = null), (pt = tt[--nt]), (tt[nt] = null));
  }
  function Xh(e, t) {
    ((tt[nt++] = pt), (tt[nt++] = _t), (tt[nt++] = wn), (pt = t.id), (_t = t.overflow), (wn = e));
  }
  var Se = null,
    Z = null,
    L = !1,
    hn = null,
    lt = !1,
    Qu = Error(p(519));
  function Sn(e) {
    var t = Error(p(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", ""));
    throw (tl(at(t, e)), Qu);
  }
  function td(e) {
    var t = e.stateNode,
      n = e.type,
      i = e.memoizedProps;
    switch (((t[we] = e), (t[Le] = i), n)) {
      case "dialog":
        (z("cancel", t), z("close", t));
        break;
      case "iframe":
      case "object":
      case "embed":
        z("load", t);
        break;
      case "video":
      case "audio":
        for (n = 0; n < ll.length; n++) z(ll[n], t);
        break;
      case "source":
        z("error", t);
        break;
      case "img":
      case "image":
      case "link":
        (z("error", t), z("load", t));
        break;
      case "details":
        z("toggle", t);
        break;
      case "input":
        (z("invalid", t), Sh(t, i.value, i.defaultValue, i.checked, i.defaultChecked, i.type, i.name, !0));
        break;
      case "select":
        z("invalid", t);
        break;
      case "textarea":
        (z("invalid", t), Ah(t, i.value, i.defaultValue, i.children));
    }
    ((n = i.children),
      (typeof n != "string" && typeof n != "number" && typeof n != "bigint") ||
      t.textContent === "" + n ||
      i.suppressHydrationWarning === !0 ||
      xy(t.textContent, n)
        ? (i.popover != null && (z("beforetoggle", t), z("toggle", t)),
          i.onScroll != null && z("scroll", t),
          i.onScrollEnd != null && z("scrollend", t),
          i.onClick != null && (t.onclick = qt),
          (t = !0))
        : (t = !1),
      t || Sn(e, !0));
  }
  function nd(e) {
    for (Se = e.return; Se;)
      switch (Se.tag) {
        case 5:
        case 31:
        case 13:
          lt = !1;
          return;
        case 27:
        case 3:
          lt = !0;
          return;
        default:
          Se = Se.return;
      }
  }
  function Si(e) {
    if (e !== Se) return !1;
    if (!L) return (nd(e), (L = !0), !1);
    var t = e.tag,
      n;
    if (
      ((n = t !== 3 && t !== 27) &&
        ((n = t === 5) && ((n = e.type), (n = !(n !== "form" && n !== "button") || _o(e.type, e.memoizedProps))),
        (n = !n)),
      n && Z && Sn(e),
      nd(e),
      t === 13)
    ) {
      if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e)) throw Error(p(317));
      Z = Id(e);
    } else if (t === 31) {
      if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e)) throw Error(p(317));
      Z = Id(e);
    } else
      t === 27
        ? ((t = Z), Tn(e.type) ? ((e = Eo), (Eo = null), (Z = e)) : (Z = t))
        : (Z = Se ? st(e.stateNode.nextSibling) : null);
    return !0;
  }
  function Vn() {
    ((Z = Se = null), (L = !1));
  }
  function cu() {
    var e = hn;
    return (e !== null && (Me === null ? (Me = e) : Me.push.apply(Me, e), (hn = null)), e);
  }
  function tl(e) {
    hn === null ? (hn = [e]) : hn.push(e);
  }
  var Ju = St(null),
    ei = null,
    Lt = null;
  function nn(e, t, n) {
    (X(Ju, t._currentValue), (t._currentValue = n));
  }
  function Bt(e) {
    ((e._currentValue = Ju.current), pe(Ju));
  }
  function Zu(e, t, n) {
    for (; e !== null;) {
      var i = e.alternate;
      if (
        ((e.childLanes & t) !== t
          ? ((e.childLanes |= t), i !== null && (i.childLanes |= t))
          : i !== null && (i.childLanes & t) !== t && (i.childLanes |= t),
        e === n)
      )
        break;
      e = e.return;
    }
  }
  function $u(e, t, n, i) {
    var a = e.child;
    for (a !== null && (a.return = e); a !== null;) {
      var l = a.dependencies;
      if (l !== null) {
        var r = a.child;
        l = l.firstContext;
        e: for (; l !== null;) {
          var s = l;
          l = a;
          for (var u = 0; u < t.length; u++)
            if (s.context === t[u]) {
              ((l.lanes |= n), (s = l.alternate), s !== null && (s.lanes |= n), Zu(l.return, n, e), i || (r = null));
              break e;
            }
          l = s.next;
        }
      } else if (a.tag === 18) {
        if (((r = a.return), r === null)) throw Error(p(341));
        ((r.lanes |= n), (l = r.alternate), l !== null && (l.lanes |= n), Zu(r, n, e), (r = null));
      } else r = a.child;
      if (r !== null) r.return = a;
      else
        for (r = a; r !== null;) {
          if (r === e) {
            r = null;
            break;
          }
          if (((a = r.sibling), a !== null)) {
            ((a.return = r.return), (r = a));
            break;
          }
          r = r.return;
        }
      a = r;
    }
  }
  function aa(e, t, n, i) {
    e = null;
    for (var a = t, l = !1; a !== null;) {
      if (!l) {
        if ((a.flags & 524288) !== 0) l = !0;
        else if ((a.flags & 262144) !== 0) break;
      }
      if (a.tag === 10) {
        var r = a.alternate;
        if (r === null) throw Error(p(387));
        if (((r = r.memoizedProps), r !== null)) {
          var s = a.type;
          Je(a.pendingProps.value, r.value) || (e !== null ? e.push(s) : (e = [s]));
        }
      } else if (a === yr.current) {
        if (((r = a.alternate), r === null)) throw Error(p(387));
        r.memoizedState.memoizedState !== a.memoizedState.memoizedState && (e !== null ? e.push(sl) : (e = [sl]));
      }
      a = a.return;
    }
    (e !== null && $u(t, e, n, i), (t.flags |= 262144));
  }
  function Er(e) {
    for (e = e.firstContext; e !== null;) {
      if (!Je(e.context._currentValue, e.memoizedValue)) return !0;
      e = e.next;
    }
    return !1;
  }
  function Xn(e) {
    ((ei = e), (Lt = null), (e = e.dependencies), e !== null && (e.firstContext = null));
  }
  function Ee(e) {
    return Qh(ei, e);
  }
  function Il(e, t) {
    return (ei === null && Xn(e), Qh(e, t));
  }
  function Qh(e, t) {
    var n = t._currentValue;
    if (((t = { context: t, memoizedValue: n, next: null }), Lt === null)) {
      if (e === null) throw Error(p(308));
      ((Lt = t), (e.dependencies = { lanes: 0, firstContext: t }), (e.flags |= 524288));
    } else Lt = Lt.next = t;
    return n;
  }
  var jp =
      typeof AbortController < "u"
        ? AbortController
        : function () {
            var e = [],
              t = (this.signal = {
                aborted: !1,
                addEventListener: function (n, i) {
                  e.push(i);
                },
              });
            this.abort = function () {
              ((t.aborted = !0),
                e.forEach(function (n) {
                  return n();
                }));
            };
          },
    Mp = ye.unstable_scheduleCallback,
    qp = ye.unstable_NormalPriority,
    fe = { $$typeof: Mt, Consumer: null, Provider: null, _currentValue: null, _currentValue2: null, _threadCount: 0 };
  function Yo() {
    return { controller: new jp(), data: new Map(), refCount: 0 };
  }
  function ml(e) {
    (e.refCount--,
      e.refCount === 0 &&
        Mp(qp, function () {
          e.controller.abort();
        }));
  }
  var Ba = null,
    Wu = 0,
    Ji = 0,
    Gi = null;
  function Lp(e, t) {
    if (Ba === null) {
      var n = (Ba = []);
      ((Wu = 0),
        (Ji = gc()),
        (Gi = {
          status: "pending",
          value: void 0,
          then: function (i) {
            n.push(i);
          },
        }));
    }
    return (Wu++, t.then(id, id), t);
  }
  function id() {
    if (--Wu === 0 && Ba !== null) {
      Gi !== null && (Gi.status = "fulfilled");
      var e = Ba;
      ((Ba = null), (Ji = 0), (Gi = null));
      for (var t = 0; t < e.length; t++) (0, e[t])();
    }
  }
  function Hp(e, t) {
    var n = [],
      i = {
        status: "pending",
        value: null,
        reason: null,
        then: function (a) {
          n.push(a);
        },
      };
    return (
      e.then(
        function () {
          ((i.status = "fulfilled"), (i.value = t));
          for (var a = 0; a < n.length; a++) (0, n[a])(t);
        },
        function (a) {
          for (i.status = "rejected", i.reason = a, a = 0; a < n.length; a++) (0, n[a])(void 0);
        },
      ),
      i
    );
  }
  var ad = U.S;
  U.S = function (e, t) {
    ((sy = Ie()),
      typeof t == "object" && t !== null && typeof t.then == "function" && Lp(e, t),
      ad !== null && ad(e, t));
  };
  var Kn = St(null);
  function Io() {
    var e = Kn.current;
    return e !== null ? e : V.pooledCache;
  }
  function lr(e, t) {
    t === null ? X(Kn, Kn.current) : X(Kn, t.pool);
  }
  function Jh() {
    var e = Io();
    return e === null ? null : { parent: fe._currentValue, pool: e };
  }
  var la = Error(p(460)),
    Vo = Error(p(474)),
    $r = Error(p(542)),
    Ar = { then: function () {} };
  function ld(e) {
    return ((e = e.status), e === "fulfilled" || e === "rejected");
  }
  function Zh(e, t, n) {
    switch (((n = e[n]), n === void 0 ? e.push(t) : n !== t && (t.then(qt, qt), (t = n)), t.status)) {
      case "fulfilled":
        return t.value;
      case "rejected":
        throw ((e = t.reason), sd(e), e);
      default:
        if (typeof t.status == "string") t.then(qt, qt);
        else {
          if (((e = V), e !== null && 100 < e.shellSuspendCounter)) throw Error(p(482));
          ((e = t),
            (e.status = "pending"),
            e.then(
              function (i) {
                if (t.status === "pending") {
                  var a = t;
                  ((a.status = "fulfilled"), (a.value = i));
                }
              },
              function (i) {
                if (t.status === "pending") {
                  var a = t;
                  ((a.status = "rejected"), (a.reason = i));
                }
              },
            ));
        }
        switch (t.status) {
          case "fulfilled":
            return t.value;
          case "rejected":
            throw ((e = t.reason), sd(e), e);
        }
        throw ((Yn = t), la);
    }
  }
  function Ln(e) {
    try {
      var t = e._init;
      return t(e._payload);
    } catch (n) {
      throw n !== null && typeof n == "object" && typeof n.then == "function" ? ((Yn = n), la) : n;
    }
  }
  var Yn = null;
  function rd() {
    if (Yn === null) throw Error(p(459));
    var e = Yn;
    return ((Yn = null), e);
  }
  function sd(e) {
    if (e === la || e === $r) throw Error(p(483));
  }
  var Ki = null,
    nl = 0;
  function Vl(e) {
    var t = nl;
    return ((nl += 1), Ki === null && (Ki = []), Zh(Ki, e, t));
  }
  function Oa(e, t) {
    ((t = t.props.ref), (e.ref = t !== void 0 ? t : null));
  }
  function Xl(e, t) {
    throw t.$$typeof === Rv
      ? Error(p(525))
      : ((e = Object.prototype.toString.call(t)),
        Error(p(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
  }
  function $h(e) {
    function t(y, c) {
      if (e) {
        var h = y.deletions;
        h === null ? ((y.deletions = [c]), (y.flags |= 16)) : h.push(c);
      }
    }
    function n(y, c) {
      if (!e) return null;
      for (; c !== null;) (t(y, c), (c = c.sibling));
      return null;
    }
    function i(y) {
      for (var c = new Map(); y !== null;) (y.key !== null ? c.set(y.key, y) : c.set(y.index, y), (y = y.sibling));
      return c;
    }
    function a(y, c) {
      return ((y = Ht(y, c)), (y.index = 0), (y.sibling = null), y);
    }
    function l(y, c, h) {
      return (
        (y.index = h),
        e
          ? ((h = y.alternate),
            h !== null ? ((h = h.index), h < c ? ((y.flags |= 67108866), c) : h) : ((y.flags |= 67108866), c))
          : ((y.flags |= 1048576), c)
      );
    }
    function r(y) {
      return (e && y.alternate === null && (y.flags |= 67108866), y);
    }
    function s(y, c, h, v) {
      return c === null || c.tag !== 6
        ? ((c = uu(h, y.mode, v)), (c.return = y), c)
        : ((c = a(c, h)), (c.return = y), c);
    }
    function u(y, c, h, v) {
      var E = h.type;
      return E === Ti
        ? f(y, c, h.props.children, v, h.key)
        : c !== null &&
            (c.elementType === E || (typeof E == "object" && E !== null && E.$$typeof === en && Ln(E) === c.type))
          ? ((c = a(c, h.props)), Oa(c, h), (c.return = y), c)
          : ((c = ar(h.type, h.key, h.props, null, y.mode, v)), Oa(c, h), (c.return = y), c);
    }
    function o(y, c, h, v) {
      return c === null ||
        c.tag !== 4 ||
        c.stateNode.containerInfo !== h.containerInfo ||
        c.stateNode.implementation !== h.implementation
        ? ((c = ou(h, y.mode, v)), (c.return = y), c)
        : ((c = a(c, h.children || [])), (c.return = y), c);
    }
    function f(y, c, h, v, E) {
      return c === null || c.tag !== 7
        ? ((c = Gn(h, y.mode, v, E)), (c.return = y), c)
        : ((c = a(c, h)), (c.return = y), c);
    }
    function m(y, c, h) {
      if ((typeof c == "string" && c !== "") || typeof c == "number" || typeof c == "bigint")
        return ((c = uu("" + c, y.mode, h)), (c.return = y), c);
      if (typeof c == "object" && c !== null) {
        switch (c.$$typeof) {
          case Ml:
            return ((h = ar(c.type, c.key, c.props, null, y.mode, h)), Oa(h, c), (h.return = y), h);
          case Na:
            return ((c = ou(c, y.mode, h)), (c.return = y), c);
          case en:
            return ((c = Ln(c)), m(y, c, h));
        }
        if (Da(c) || Ra(c)) return ((c = Gn(c, y.mode, h, null)), (c.return = y), c);
        if (typeof c.then == "function") return m(y, Vl(c), h);
        if (c.$$typeof === Mt) return m(y, Il(y, c), h);
        Xl(y, c);
      }
      return null;
    }
    function d(y, c, h, v) {
      var E = c !== null ? c.key : null;
      if ((typeof h == "string" && h !== "") || typeof h == "number" || typeof h == "bigint")
        return E !== null ? null : s(y, c, "" + h, v);
      if (typeof h == "object" && h !== null) {
        switch (h.$$typeof) {
          case Ml:
            return h.key === E ? u(y, c, h, v) : null;
          case Na:
            return h.key === E ? o(y, c, h, v) : null;
          case en:
            return ((h = Ln(h)), d(y, c, h, v));
        }
        if (Da(h) || Ra(h)) return E !== null ? null : f(y, c, h, v, null);
        if (typeof h.then == "function") return d(y, c, Vl(h), v);
        if (h.$$typeof === Mt) return d(y, c, Il(y, h), v);
        Xl(y, h);
      }
      return null;
    }
    function g(y, c, h, v, E) {
      if ((typeof v == "string" && v !== "") || typeof v == "number" || typeof v == "bigint")
        return ((y = y.get(h) || null), s(c, y, "" + v, E));
      if (typeof v == "object" && v !== null) {
        switch (v.$$typeof) {
          case Ml:
            return ((y = y.get(v.key === null ? h : v.key) || null), u(c, y, v, E));
          case Na:
            return ((y = y.get(v.key === null ? h : v.key) || null), o(c, y, v, E));
          case en:
            return ((v = Ln(v)), g(y, c, h, v, E));
        }
        if (Da(v) || Ra(v)) return ((y = y.get(h) || null), f(c, y, v, E, null));
        if (typeof v.then == "function") return g(y, c, h, Vl(v), E);
        if (v.$$typeof === Mt) return g(y, c, h, Il(c, v), E);
        Xl(c, v);
      }
      return null;
    }
    function _(y, c, h, v) {
      for (var E = null, O = null, w = c, x = (c = 0), C = null; w !== null && x < h.length; x++) {
        w.index > x ? ((C = w), (w = null)) : (C = w.sibling);
        var q = d(y, w, h[x], v);
        if (q === null) {
          w === null && (w = C);
          break;
        }
        (e && w && q.alternate === null && t(y, w),
          (c = l(q, c, x)),
          O === null ? (E = q) : (O.sibling = q),
          (O = q),
          (w = C));
      }
      if (x === h.length) return (n(y, w), L && zt(y, x), E);
      if (w === null) {
        for (; x < h.length; x++)
          ((w = m(y, h[x], v)), w !== null && ((c = l(w, c, x)), O === null ? (E = w) : (O.sibling = w), (O = w)));
        return (L && zt(y, x), E);
      }
      for (w = i(w); x < h.length; x++)
        ((C = g(w, y, x, h[x], v)),
          C !== null &&
            (e && C.alternate !== null && w.delete(C.key === null ? x : C.key),
            (c = l(C, c, x)),
            O === null ? (E = C) : (O.sibling = C),
            (O = C)));
      return (
        e &&
          w.forEach(function (xe) {
            return t(y, xe);
          }),
        L && zt(y, x),
        E
      );
    }
    function b(y, c, h, v) {
      if (h == null) throw Error(p(151));
      for (
        var E = null, O = null, w = c, x = (c = 0), C = null, q = h.next();
        w !== null && !q.done;
        x++, q = h.next()
      ) {
        w.index > x ? ((C = w), (w = null)) : (C = w.sibling);
        var xe = d(y, w, q.value, v);
        if (xe === null) {
          w === null && (w = C);
          break;
        }
        (e && w && xe.alternate === null && t(y, w),
          (c = l(xe, c, x)),
          O === null ? (E = xe) : (O.sibling = xe),
          (O = xe),
          (w = C));
      }
      if (q.done) return (n(y, w), L && zt(y, x), E);
      if (w === null) {
        for (; !q.done; x++, q = h.next())
          ((q = m(y, q.value, v)), q !== null && ((c = l(q, c, x)), O === null ? (E = q) : (O.sibling = q), (O = q)));
        return (L && zt(y, x), E);
      }
      for (w = i(w); !q.done; x++, q = h.next())
        ((q = g(w, y, x, q.value, v)),
          q !== null &&
            (e && q.alternate !== null && w.delete(q.key === null ? x : q.key),
            (c = l(q, c, x)),
            O === null ? (E = q) : (O.sibling = q),
            (O = q)));
      return (
        e &&
          w.forEach(function (Wt) {
            return t(y, Wt);
          }),
        L && zt(y, x),
        E
      );
    }
    function A(y, c, h, v) {
      if (
        (typeof h == "object" && h !== null && h.type === Ti && h.key === null && (h = h.props.children),
        typeof h == "object" && h !== null)
      ) {
        switch (h.$$typeof) {
          case Ml:
            e: {
              for (var E = h.key; c !== null;) {
                if (c.key === E) {
                  if (((E = h.type), E === Ti)) {
                    if (c.tag === 7) {
                      (n(y, c.sibling), (v = a(c, h.props.children)), (v.return = y), (y = v));
                      break e;
                    }
                  } else if (
                    c.elementType === E ||
                    (typeof E == "object" && E !== null && E.$$typeof === en && Ln(E) === c.type)
                  ) {
                    (n(y, c.sibling), (v = a(c, h.props)), Oa(v, h), (v.return = y), (y = v));
                    break e;
                  }
                  n(y, c);
                  break;
                } else t(y, c);
                c = c.sibling;
              }
              h.type === Ti
                ? ((v = Gn(h.props.children, y.mode, v, h.key)), (v.return = y), (y = v))
                : ((v = ar(h.type, h.key, h.props, null, y.mode, v)), Oa(v, h), (v.return = y), (y = v));
            }
            return r(y);
          case Na:
            e: {
              for (E = h.key; c !== null;) {
                if (c.key === E)
                  if (
                    c.tag === 4 &&
                    c.stateNode.containerInfo === h.containerInfo &&
                    c.stateNode.implementation === h.implementation
                  ) {
                    (n(y, c.sibling), (v = a(c, h.children || [])), (v.return = y), (y = v));
                    break e;
                  } else {
                    n(y, c);
                    break;
                  }
                else t(y, c);
                c = c.sibling;
              }
              ((v = ou(h, y.mode, v)), (v.return = y), (y = v));
            }
            return r(y);
          case en:
            return ((h = Ln(h)), A(y, c, h, v));
        }
        if (Da(h)) return _(y, c, h, v);
        if (Ra(h)) {
          if (((E = Ra(h)), typeof E != "function")) throw Error(p(150));
          return ((h = E.call(h)), b(y, c, h, v));
        }
        if (typeof h.then == "function") return A(y, c, Vl(h), v);
        if (h.$$typeof === Mt) return A(y, c, Il(y, h), v);
        Xl(y, h);
      }
      return (typeof h == "string" && h !== "") || typeof h == "number" || typeof h == "bigint"
        ? ((h = "" + h),
          c !== null && c.tag === 6
            ? (n(y, c.sibling), (v = a(c, h)), (v.return = y), (y = v))
            : (n(y, c), (v = uu(h, y.mode, v)), (v.return = y), (y = v)),
          r(y))
        : n(y, c);
    }
    return function (y, c, h, v) {
      try {
        nl = 0;
        var E = A(y, c, h, v);
        return ((Ki = null), E);
      } catch (w) {
        if (w === la || w === $r) throw w;
        var O = Ke(29, w, null, y.mode);
        return ((O.lanes = v), (O.return = y), O);
      } finally {
      }
    };
  }
  var Qn = $h(!0),
    Wh = $h(!1),
    tn = !1;
  function Xo(e) {
    e.updateQueue = {
      baseState: e.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null,
    };
  }
  function Fu(e, t) {
    ((e = e.updateQueue),
      t.updateQueue === e &&
        (t.updateQueue = {
          baseState: e.baseState,
          firstBaseUpdate: e.firstBaseUpdate,
          lastBaseUpdate: e.lastBaseUpdate,
          shared: e.shared,
          callbacks: null,
        }));
  }
  function gn(e) {
    return { lane: e, tag: 0, payload: null, callback: null, next: null };
  }
  function yn(e, t, n) {
    var i = e.updateQueue;
    if (i === null) return null;
    if (((i = i.shared), (H & 2) !== 0)) {
      var a = i.pending;
      return (
        a === null ? (t.next = t) : ((t.next = a.next), (a.next = t)),
        (i.pending = t),
        (t = wr(e)),
        Kh(e, null, n),
        t
      );
    }
    return (Zr(e, i, t, n), wr(e));
  }
  function Ga(e, t, n) {
    if (((t = t.updateQueue), t !== null && ((t = t.shared), (n & 4194048) !== 0))) {
      var i = t.lanes;
      ((i &= e.pendingLanes), (n |= i), (t.lanes = n), yh(e, n));
    }
  }
  function fu(e, t) {
    var n = e.updateQueue,
      i = e.alternate;
    if (i !== null && ((i = i.updateQueue), n === i)) {
      var a = null,
        l = null;
      if (((n = n.firstBaseUpdate), n !== null)) {
        do {
          var r = { lane: n.lane, tag: n.tag, payload: n.payload, callback: null, next: null };
          (l === null ? (a = l = r) : (l = l.next = r), (n = n.next));
        } while (n !== null);
        l === null ? (a = l = t) : (l = l.next = t);
      } else a = l = t;
      ((n = {
        baseState: i.baseState,
        firstBaseUpdate: a,
        lastBaseUpdate: l,
        shared: i.shared,
        callbacks: i.callbacks,
      }),
        (e.updateQueue = n));
      return;
    }
    ((e = n.lastBaseUpdate), e === null ? (n.firstBaseUpdate = t) : (e.next = t), (n.lastBaseUpdate = t));
  }
  var Pu = !1;
  function Ka() {
    if (Pu) {
      var e = Gi;
      if (e !== null) throw e;
    }
  }
  function Ya(e, t, n, i) {
    Pu = !1;
    var a = e.updateQueue;
    tn = !1;
    var l = a.firstBaseUpdate,
      r = a.lastBaseUpdate,
      s = a.shared.pending;
    if (s !== null) {
      a.shared.pending = null;
      var u = s,
        o = u.next;
      ((u.next = null), r === null ? (l = o) : (r.next = o), (r = u));
      var f = e.alternate;
      f !== null &&
        ((f = f.updateQueue),
        (s = f.lastBaseUpdate),
        s !== r && (s === null ? (f.firstBaseUpdate = o) : (s.next = o), (f.lastBaseUpdate = u)));
    }
    if (l !== null) {
      var m = a.baseState;
      ((r = 0), (f = o = u = null), (s = l));
      do {
        var d = s.lane & -536870913,
          g = d !== s.lane;
        if (g ? (M & d) === d : (i & d) === d) {
          (d !== 0 && d === Ji && (Pu = !0),
            f !== null && (f = f.next = { lane: 0, tag: s.tag, payload: s.payload, callback: null, next: null }));
          e: {
            var _ = e,
              b = s;
            d = t;
            var A = n;
            switch (b.tag) {
              case 1:
                if (((_ = b.payload), typeof _ == "function")) {
                  m = _.call(A, m, d);
                  break e;
                }
                m = _;
                break e;
              case 3:
                _.flags = (_.flags & -65537) | 128;
              case 0:
                if (((_ = b.payload), (d = typeof _ == "function" ? _.call(A, m, d) : _), d == null)) break e;
                m = $({}, m, d);
                break e;
              case 2:
                tn = !0;
            }
          }
          ((d = s.callback),
            d !== null &&
              ((e.flags |= 64),
              g && (e.flags |= 8192),
              (g = a.callbacks),
              g === null ? (a.callbacks = [d]) : g.push(d)));
        } else
          ((g = { lane: d, tag: s.tag, payload: s.payload, callback: s.callback, next: null }),
            f === null ? ((o = f = g), (u = m)) : (f = f.next = g),
            (r |= d));
        if (((s = s.next), s === null)) {
          if (((s = a.shared.pending), s === null)) break;
          ((g = s), (s = g.next), (g.next = null), (a.lastBaseUpdate = g), (a.shared.pending = null));
        }
      } while (!0);
      (f === null && (u = m),
        (a.baseState = u),
        (a.firstBaseUpdate = o),
        (a.lastBaseUpdate = f),
        l === null && (a.shared.lanes = 0),
        (An |= r),
        (e.lanes = r),
        (e.memoizedState = m));
    }
  }
  function Fh(e, t) {
    if (typeof e != "function") throw Error(p(191, e));
    e.call(t);
  }
  function Ph(e, t) {
    var n = e.callbacks;
    if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) Fh(n[e], t);
  }
  var Zi = St(null),
    Rr = St(0);
  function ud(e, t) {
    ((e = Xt), X(Rr, e), X(Zi, t), (Xt = e | t.baseLanes));
  }
  function eo() {
    (X(Rr, Xt), X(Zi, Zi.current));
  }
  function Qo() {
    ((Xt = Rr.current), pe(Zi), pe(Rr));
  }
  var Ze = St(null),
    rt = null;
  function an(e) {
    var t = e.alternate;
    (X(se, se.current & 1),
      X(Ze, e),
      rt === null && (t === null || Zi.current !== null || t.memoizedState !== null) && (rt = e));
  }
  function to(e) {
    (X(se, se.current), X(Ze, e), rt === null && (rt = e));
  }
  function eg(e) {
    e.tag === 22 ? (X(se, se.current), X(Ze, e), rt === null && (rt = e)) : ln(e);
  }
  function ln() {
    (X(se, se.current), X(Ze, Ze.current));
  }
  function Ge(e) {
    (pe(Ze), rt === e && (rt = null), pe(se));
  }
  var se = St(0);
  function Tr(e) {
    for (var t = e; t !== null;) {
      if (t.tag === 13) {
        var n = t.memoizedState;
        if (n !== null && ((n = n.dehydrated), n === null || wo(n) || So(n))) return t;
      } else if (
        t.tag === 19 &&
        (t.memoizedProps.revealOrder === "forwards" ||
          t.memoizedProps.revealOrder === "backwards" ||
          t.memoizedProps.revealOrder === "unstable_legacy-backwards" ||
          t.memoizedProps.revealOrder === "together")
      ) {
        if ((t.flags & 128) !== 0) return t;
      } else if (t.child !== null) {
        ((t.child.return = t), (t = t.child));
        continue;
      }
      if (t === e) break;
      for (; t.sibling === null;) {
        if (t.return === null || t.return === e) return null;
        t = t.return;
      }
      ((t.sibling.return = t.return), (t = t.sibling));
    }
    return null;
  }
  var Yt = 0,
    D = null,
    I = null,
    oe = null,
    Or = !1,
    Yi = !1,
    Jn = !1,
    xr = 0,
    il = 0,
    Ii = null,
    Bp = 0;
  function ie() {
    throw Error(p(321));
  }
  function Jo(e, t) {
    if (t === null) return !1;
    for (var n = 0; n < t.length && n < e.length; n++) if (!Je(e[n], t[n])) return !1;
    return !0;
  }
  function Zo(e, t, n, i, a, l) {
    return (
      (Yt = l),
      (D = t),
      (t.memoizedState = null),
      (t.updateQueue = null),
      (t.lanes = 0),
      (U.H = e === null || e.memoizedState === null ? Ug : rc),
      (Jn = !1),
      (l = n(i, a)),
      (Jn = !1),
      Yi && (l = ng(t, n, i, a)),
      tg(e),
      l
    );
  }
  function tg(e) {
    U.H = al;
    var t = I !== null && I.next !== null;
    if (((Yt = 0), (oe = I = D = null), (Or = !1), (il = 0), (Ii = null), t)) throw Error(p(300));
    e === null || de || ((e = e.dependencies), e !== null && Er(e) && (de = !0));
  }
  function ng(e, t, n, i) {
    D = e;
    var a = 0;
    do {
      if ((Yi && (Ii = null), (il = 0), (Yi = !1), 25 <= a)) throw Error(p(301));
      if (((a += 1), (oe = I = null), e.updateQueue != null)) {
        var l = e.updateQueue;
        ((l.lastEffect = null), (l.events = null), (l.stores = null), l.memoCache != null && (l.memoCache.index = 0));
      }
      ((U.H = Ng), (l = t(n, i)));
    } while (Yi);
    return l;
  }
  function Gp() {
    var e = U.H,
      t = e.useState()[0];
    return (
      (t = typeof t.then == "function" ? vl(t) : t),
      (e = e.useState()[0]),
      (I !== null ? I.memoizedState : null) !== e && (D.flags |= 1024),
      t
    );
  }
  function $o() {
    var e = xr !== 0;
    return ((xr = 0), e);
  }
  function Wo(e, t, n) {
    ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~n));
  }
  function Fo(e) {
    if (Or) {
      for (e = e.memoizedState; e !== null;) {
        var t = e.queue;
        (t !== null && (t.pending = null), (e = e.next));
      }
      Or = !1;
    }
    ((Yt = 0), (oe = I = D = null), (Yi = !1), (il = xr = 0), (Ii = null));
  }
  function Ne() {
    var e = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
    return (oe === null ? (D.memoizedState = oe = e) : (oe = oe.next = e), oe);
  }
  function ue() {
    if (I === null) {
      var e = D.alternate;
      e = e !== null ? e.memoizedState : null;
    } else e = I.next;
    var t = oe === null ? D.memoizedState : oe.next;
    if (t !== null) ((oe = t), (I = e));
    else {
      if (e === null) throw D.alternate === null ? Error(p(467)) : Error(p(310));
      ((I = e),
        (e = {
          memoizedState: I.memoizedState,
          baseState: I.baseState,
          baseQueue: I.baseQueue,
          queue: I.queue,
          next: null,
        }),
        oe === null ? (D.memoizedState = oe = e) : (oe = oe.next = e));
    }
    return oe;
  }
  function Wr() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function vl(e) {
    var t = il;
    return (
      (il += 1),
      Ii === null && (Ii = []),
      (e = Zh(Ii, e, t)),
      (t = D),
      (oe === null ? t.memoizedState : oe.next) === null &&
        ((t = t.alternate), (U.H = t === null || t.memoizedState === null ? Ug : rc)),
      e
    );
  }
  function Fr(e) {
    if (e !== null && typeof e == "object") {
      if (typeof e.then == "function") return vl(e);
      if (e.$$typeof === Mt) return Ee(e);
    }
    throw Error(p(438, String(e)));
  }
  function Po(e) {
    var t = null,
      n = D.updateQueue;
    if ((n !== null && (t = n.memoCache), t == null)) {
      var i = D.alternate;
      i !== null &&
        ((i = i.updateQueue),
        i !== null &&
          ((i = i.memoCache),
          i != null &&
            (t = {
              data: i.data.map(function (a) {
                return a.slice();
              }),
              index: 0,
            })));
    }
    if (
      (t == null && (t = { data: [], index: 0 }),
      n === null && ((n = Wr()), (D.updateQueue = n)),
      (n.memoCache = t),
      (n = t.data[t.index]),
      n === void 0)
    )
      for (n = t.data[t.index] = Array(e), i = 0; i < e; i++) n[i] = Tv;
    return (t.index++, n);
  }
  function It(e, t) {
    return typeof t == "function" ? t(e) : t;
  }
  function rr(e) {
    var t = ue();
    return ec(t, I, e);
  }
  function ec(e, t, n) {
    var i = e.queue;
    if (i === null) throw Error(p(311));
    i.lastRenderedReducer = n;
    var a = e.baseQueue,
      l = i.pending;
    if (l !== null) {
      if (a !== null) {
        var r = a.next;
        ((a.next = l.next), (l.next = r));
      }
      ((t.baseQueue = a = l), (i.pending = null));
    }
    if (((l = e.baseState), a === null)) e.memoizedState = l;
    else {
      t = a.next;
      var s = (r = null),
        u = null,
        o = t,
        f = !1;
      do {
        var m = o.lane & -536870913;
        if (m !== o.lane ? (M & m) === m : (Yt & m) === m) {
          var d = o.revertLane;
          if (d === 0)
            (u !== null &&
              (u = u.next =
                {
                  lane: 0,
                  revertLane: 0,
                  gesture: null,
                  action: o.action,
                  hasEagerState: o.hasEagerState,
                  eagerState: o.eagerState,
                  next: null,
                }),
              m === Ji && (f = !0));
          else if ((Yt & d) === d) {
            ((o = o.next), d === Ji && (f = !0));
            continue;
          } else
            ((m = {
              lane: 0,
              revertLane: o.revertLane,
              gesture: null,
              action: o.action,
              hasEagerState: o.hasEagerState,
              eagerState: o.eagerState,
              next: null,
            }),
              u === null ? ((s = u = m), (r = l)) : (u = u.next = m),
              (D.lanes |= d),
              (An |= d));
          ((m = o.action), Jn && n(l, m), (l = o.hasEagerState ? o.eagerState : n(l, m)));
        } else
          ((d = {
            lane: m,
            revertLane: o.revertLane,
            gesture: o.gesture,
            action: o.action,
            hasEagerState: o.hasEagerState,
            eagerState: o.eagerState,
            next: null,
          }),
            u === null ? ((s = u = d), (r = l)) : (u = u.next = d),
            (D.lanes |= m),
            (An |= m));
        o = o.next;
      } while (o !== null && o !== t);
      if ((u === null ? (r = l) : (u.next = s), !Je(l, e.memoizedState) && ((de = !0), f && ((n = Gi), n !== null))))
        throw n;
      ((e.memoizedState = l), (e.baseState = r), (e.baseQueue = u), (i.lastRenderedState = l));
    }
    return (a === null && (i.lanes = 0), [e.memoizedState, i.dispatch]);
  }
  function du(e) {
    var t = ue(),
      n = t.queue;
    if (n === null) throw Error(p(311));
    n.lastRenderedReducer = e;
    var i = n.dispatch,
      a = n.pending,
      l = t.memoizedState;
    if (a !== null) {
      n.pending = null;
      var r = (a = a.next);
      do ((l = e(l, r.action)), (r = r.next));
      while (r !== a);
      (Je(l, t.memoizedState) || (de = !0),
        (t.memoizedState = l),
        t.baseQueue === null && (t.baseState = l),
        (n.lastRenderedState = l));
    }
    return [l, i];
  }
  function ig(e, t, n) {
    var i = D,
      a = ue(),
      l = L;
    if (l) {
      if (n === void 0) throw Error(p(407));
      n = n();
    } else n = t();
    var r = !Je((I || a).memoizedState, n);
    if (
      (r && ((a.memoizedState = n), (de = !0)),
      (a = a.queue),
      tc(rg.bind(null, i, a, e), [e]),
      a.getSnapshot !== t || r || (oe !== null && oe.memoizedState.tag & 1))
    ) {
      if (((i.flags |= 2048), $i(9, { destroy: void 0 }, lg.bind(null, i, a, n, t), null), V === null))
        throw Error(p(349));
      l || (Yt & 127) !== 0 || ag(i, t, n);
    }
    return n;
  }
  function ag(e, t, n) {
    ((e.flags |= 16384),
      (e = { getSnapshot: t, value: n }),
      (t = D.updateQueue),
      t === null
        ? ((t = Wr()), (D.updateQueue = t), (t.stores = [e]))
        : ((n = t.stores), n === null ? (t.stores = [e]) : n.push(e)));
  }
  function lg(e, t, n, i) {
    ((t.value = n), (t.getSnapshot = i), sg(t) && ug(e));
  }
  function rg(e, t, n) {
    return n(function () {
      sg(t) && ug(e);
    });
  }
  function sg(e) {
    var t = e.getSnapshot;
    e = e.value;
    try {
      var n = t();
      return !Je(e, n);
    } catch {
      return !0;
    }
  }
  function ug(e) {
    var t = Pn(e, 2);
    t !== null && qe(t, e, 2);
  }
  function no(e) {
    var t = Ne();
    if (typeof e == "function") {
      var n = e;
      if (((e = n()), Jn)) {
        sn(!0);
        try {
          n();
        } finally {
          sn(!1);
        }
      }
    }
    return (
      (t.memoizedState = t.baseState = e),
      (t.queue = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: It, lastRenderedState: e }),
      t
    );
  }
  function og(e, t, n, i) {
    return ((e.baseState = n), ec(e, I, typeof i == "function" ? i : It));
  }
  function Kp(e, t, n, i, a) {
    if (es(e)) throw Error(p(485));
    if (((e = t.action), e !== null)) {
      var l = {
        payload: a,
        action: e,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function (r) {
          l.listeners.push(r);
        },
      };
      (U.T !== null ? n(!0) : (l.isTransition = !1),
        i(l),
        (n = t.pending),
        n === null ? ((l.next = t.pending = l), cg(t, l)) : ((l.next = n.next), (t.pending = n.next = l)));
    }
  }
  function cg(e, t) {
    var n = t.action,
      i = t.payload,
      a = e.state;
    if (t.isTransition) {
      var l = U.T,
        r = {};
      U.T = r;
      try {
        var s = n(a, i),
          u = U.S;
        (u !== null && u(r, s), od(e, t, s));
      } catch (o) {
        io(e, t, o);
      } finally {
        (l !== null && r.types !== null && (l.types = r.types), (U.T = l));
      }
    } else
      try {
        ((l = n(a, i)), od(e, t, l));
      } catch (o) {
        io(e, t, o);
      }
  }
  function od(e, t, n) {
    n !== null && typeof n == "object" && typeof n.then == "function"
      ? n.then(
          function (i) {
            cd(e, t, i);
          },
          function (i) {
            return io(e, t, i);
          },
        )
      : cd(e, t, n);
  }
  function cd(e, t, n) {
    ((t.status = "fulfilled"),
      (t.value = n),
      fg(t),
      (e.state = n),
      (t = e.pending),
      t !== null && ((n = t.next), n === t ? (e.pending = null) : ((n = n.next), (t.next = n), cg(e, n))));
  }
  function io(e, t, n) {
    var i = e.pending;
    if (((e.pending = null), i !== null)) {
      i = i.next;
      do ((t.status = "rejected"), (t.reason = n), fg(t), (t = t.next));
      while (t !== i);
    }
    e.action = null;
  }
  function fg(e) {
    e = e.listeners;
    for (var t = 0; t < e.length; t++) (0, e[t])();
  }
  function dg(e, t) {
    return t;
  }
  function fd(e, t) {
    if (L) {
      var n = V.formState;
      if (n !== null) {
        e: {
          var i = D;
          if (L) {
            if (Z) {
              t: {
                for (var a = Z, l = lt; a.nodeType !== 8;) {
                  if (!l) {
                    a = null;
                    break t;
                  }
                  if (((a = st(a.nextSibling)), a === null)) {
                    a = null;
                    break t;
                  }
                }
                ((l = a.data), (a = l === "F!" || l === "F" ? a : null));
              }
              if (a) {
                ((Z = st(a.nextSibling)), (i = a.data === "F!"));
                break e;
              }
            }
            Sn(i);
          }
          i = !1;
        }
        i && (t = n[0]);
      }
    }
    return (
      (n = Ne()),
      (n.memoizedState = n.baseState = t),
      (i = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: dg, lastRenderedState: t }),
      (n.queue = i),
      (n = xg.bind(null, D, i)),
      (i.dispatch = n),
      (i = no(!1)),
      (l = lc.bind(null, D, !1, i.queue)),
      (i = Ne()),
      (a = { state: t, dispatch: null, action: e, pending: null }),
      (i.queue = a),
      (n = Kp.bind(null, D, a, l, n)),
      (a.dispatch = n),
      (i.memoizedState = e),
      [t, n, !1]
    );
  }
  function dd(e) {
    var t = ue();
    return hg(t, I, e);
  }
  function hg(e, t, n) {
    if (((t = ec(e, t, dg)[0]), (e = rr(It)[0]), typeof t == "object" && t !== null && typeof t.then == "function"))
      try {
        var i = vl(t);
      } catch (r) {
        throw r === la ? $r : r;
      }
    else i = t;
    t = ue();
    var a = t.queue,
      l = a.dispatch;
    return (
      n !== t.memoizedState && ((D.flags |= 2048), $i(9, { destroy: void 0 }, Yp.bind(null, a, n), null)),
      [i, l, e]
    );
  }
  function Yp(e, t) {
    e.action = t;
  }
  function hd(e) {
    var t = ue(),
      n = I;
    if (n !== null) return hg(t, n, e);
    (ue(), (t = t.memoizedState), (n = ue()));
    var i = n.queue.dispatch;
    return ((n.memoizedState = e), [t, i, !1]);
  }
  function $i(e, t, n, i) {
    return (
      (e = { tag: e, create: n, deps: i, inst: t, next: null }),
      (t = D.updateQueue),
      t === null && ((t = Wr()), (D.updateQueue = t)),
      (n = t.lastEffect),
      n === null ? (t.lastEffect = e.next = e) : ((i = n.next), (n.next = e), (e.next = i), (t.lastEffect = e)),
      e
    );
  }
  function gg() {
    return ue().memoizedState;
  }
  function sr(e, t, n, i) {
    var a = Ne();
    ((D.flags |= e), (a.memoizedState = $i(1 | t, { destroy: void 0 }, n, i === void 0 ? null : i)));
  }
  function Pr(e, t, n, i) {
    var a = ue();
    i = i === void 0 ? null : i;
    var l = a.memoizedState.inst;
    I !== null && i !== null && Jo(i, I.memoizedState.deps)
      ? (a.memoizedState = $i(t, l, n, i))
      : ((D.flags |= e), (a.memoizedState = $i(1 | t, l, n, i)));
  }
  function gd(e, t) {
    sr(8390656, 8, e, t);
  }
  function tc(e, t) {
    Pr(2048, 8, e, t);
  }
  function Ip(e) {
    D.flags |= 4;
    var t = D.updateQueue;
    if (t === null) ((t = Wr()), (D.updateQueue = t), (t.events = [e]));
    else {
      var n = t.events;
      n === null ? (t.events = [e]) : n.push(e);
    }
  }
  function yg(e) {
    var t = ue().memoizedState;
    return (
      Ip({ ref: t, nextImpl: e }),
      function () {
        if ((H & 2) !== 0) throw Error(p(440));
        return t.impl.apply(void 0, arguments);
      }
    );
  }
  function mg(e, t) {
    return Pr(4, 2, e, t);
  }
  function vg(e, t) {
    return Pr(4, 4, e, t);
  }
  function pg(e, t) {
    if (typeof t == "function") {
      e = e();
      var n = t(e);
      return function () {
        typeof n == "function" ? n() : t(null);
      };
    }
    if (t != null)
      return (
        (e = e()),
        (t.current = e),
        function () {
          t.current = null;
        }
      );
  }
  function _g(e, t, n) {
    ((n = n != null ? n.concat([e]) : null), Pr(4, 4, pg.bind(null, t, e), n));
  }
  function nc() {}
  function bg(e, t) {
    var n = ue();
    t = t === void 0 ? null : t;
    var i = n.memoizedState;
    return t !== null && Jo(t, i[1]) ? i[0] : ((n.memoizedState = [e, t]), e);
  }
  function wg(e, t) {
    var n = ue();
    t = t === void 0 ? null : t;
    var i = n.memoizedState;
    if (t !== null && Jo(t, i[1])) return i[0];
    if (((i = e()), Jn)) {
      sn(!0);
      try {
        e();
      } finally {
        sn(!1);
      }
    }
    return ((n.memoizedState = [i, t]), i);
  }
  function ic(e, t, n) {
    return n === void 0 || ((Yt & 1073741824) !== 0 && (M & 261930) === 0)
      ? (e.memoizedState = t)
      : ((e.memoizedState = n), (e = oy()), (D.lanes |= e), (An |= e), n);
  }
  function Sg(e, t, n, i) {
    return Je(n, t)
      ? n
      : Zi.current !== null
        ? ((e = ic(e, n, i)), Je(e, t) || (de = !0), e)
        : (Yt & 42) === 0 || ((Yt & 1073741824) !== 0 && (M & 261930) === 0)
          ? ((de = !0), (e.memoizedState = n))
          : ((e = oy()), (D.lanes |= e), (An |= e), t);
  }
  function Eg(e, t, n, i, a) {
    var l = B.p;
    B.p = l !== 0 && 8 > l ? l : 8;
    var r = U.T,
      s = {};
    ((U.T = s), lc(e, !1, t, n));
    try {
      var u = a(),
        o = U.S;
      if ((o !== null && o(s, u), u !== null && typeof u == "object" && typeof u.then == "function")) {
        var f = Hp(u, i);
        Ia(e, t, f, Qe(e));
      } else Ia(e, t, i, Qe(e));
    } catch (m) {
      Ia(e, t, { then: function () {}, status: "rejected", reason: m }, Qe());
    } finally {
      ((B.p = l), r !== null && s.types !== null && (r.types = s.types), (U.T = r));
    }
  }
  function Vp() {}
  function ao(e, t, n, i) {
    if (e.tag !== 5) throw Error(p(476));
    var a = Ag(e).queue;
    Eg(
      e,
      a,
      t,
      Bn,
      n === null
        ? Vp
        : function () {
            return (Rg(e), n(i));
          },
    );
  }
  function Ag(e) {
    var t = e.memoizedState;
    if (t !== null) return t;
    t = {
      memoizedState: Bn,
      baseState: Bn,
      baseQueue: null,
      queue: { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: It, lastRenderedState: Bn },
      next: null,
    };
    var n = {};
    return (
      (t.next = {
        memoizedState: n,
        baseState: n,
        baseQueue: null,
        queue: { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: It, lastRenderedState: n },
        next: null,
      }),
      (e.memoizedState = t),
      (e = e.alternate),
      e !== null && (e.memoizedState = t),
      t
    );
  }
  function Rg(e) {
    var t = Ag(e);
    (t.next === null && (t = e.alternate.memoizedState), Ia(e, t.next.queue, {}, Qe()));
  }
  function ac() {
    return Ee(sl);
  }
  function Tg() {
    return ue().memoizedState;
  }
  function Og() {
    return ue().memoizedState;
  }
  function Xp(e) {
    for (var t = e.return; t !== null;) {
      switch (t.tag) {
        case 24:
        case 3:
          var n = Qe();
          e = gn(n);
          var i = yn(t, e, n);
          (i !== null && (qe(i, t, n), Ga(i, t, n)), (t = { cache: Yo() }), (e.payload = t));
          return;
      }
      t = t.return;
    }
  }
  function Qp(e, t, n) {
    var i = Qe();
    ((n = { lane: i, revertLane: 0, gesture: null, action: n, hasEagerState: !1, eagerState: null, next: null }),
      es(e) ? kg(t, n) : ((n = Ho(e, t, n, i)), n !== null && (qe(n, e, i), Cg(n, t, i))));
  }
  function xg(e, t, n) {
    var i = Qe();
    Ia(e, t, n, i);
  }
  function Ia(e, t, n, i) {
    var a = { lane: i, revertLane: 0, gesture: null, action: n, hasEagerState: !1, eagerState: null, next: null };
    if (es(e)) kg(t, a);
    else {
      var l = e.alternate;
      if (e.lanes === 0 && (l === null || l.lanes === 0) && ((l = t.lastRenderedReducer), l !== null))
        try {
          var r = t.lastRenderedState,
            s = l(r, n);
          if (((a.hasEagerState = !0), (a.eagerState = s), Je(s, r))) return (Zr(e, t, a, 0), V === null && Jr(), !1);
        } catch {
        } finally {
        }
      if (((n = Ho(e, t, a, i)), n !== null)) return (qe(n, e, i), Cg(n, t, i), !0);
    }
    return !1;
  }
  function lc(e, t, n, i) {
    if (
      ((i = { lane: 2, revertLane: gc(), gesture: null, action: i, hasEagerState: !1, eagerState: null, next: null }),
      es(e))
    ) {
      if (t) throw Error(p(479));
    } else ((t = Ho(e, n, i, 2)), t !== null && qe(t, e, 2));
  }
  function es(e) {
    var t = e.alternate;
    return e === D || (t !== null && t === D);
  }
  function kg(e, t) {
    Yi = Or = !0;
    var n = e.pending;
    (n === null ? (t.next = t) : ((t.next = n.next), (n.next = t)), (e.pending = t));
  }
  function Cg(e, t, n) {
    if ((n & 4194048) !== 0) {
      var i = t.lanes;
      ((i &= e.pendingLanes), (n |= i), (t.lanes = n), yh(e, n));
    }
  }
  var al = {
    readContext: Ee,
    use: Fr,
    useCallback: ie,
    useContext: ie,
    useEffect: ie,
    useImperativeHandle: ie,
    useLayoutEffect: ie,
    useInsertionEffect: ie,
    useMemo: ie,
    useReducer: ie,
    useRef: ie,
    useState: ie,
    useDebugValue: ie,
    useDeferredValue: ie,
    useTransition: ie,
    useSyncExternalStore: ie,
    useId: ie,
    useHostTransitionStatus: ie,
    useFormState: ie,
    useActionState: ie,
    useOptimistic: ie,
    useMemoCache: ie,
    useCacheRefresh: ie,
  };
  al.useEffectEvent = ie;
  var Ug = {
      readContext: Ee,
      use: Fr,
      useCallback: function (e, t) {
        return ((Ne().memoizedState = [e, t === void 0 ? null : t]), e);
      },
      useContext: Ee,
      useEffect: gd,
      useImperativeHandle: function (e, t, n) {
        ((n = n != null ? n.concat([e]) : null), sr(4194308, 4, pg.bind(null, t, e), n));
      },
      useLayoutEffect: function (e, t) {
        return sr(4194308, 4, e, t);
      },
      useInsertionEffect: function (e, t) {
        sr(4, 2, e, t);
      },
      useMemo: function (e, t) {
        var n = Ne();
        t = t === void 0 ? null : t;
        var i = e();
        if (Jn) {
          sn(!0);
          try {
            e();
          } finally {
            sn(!1);
          }
        }
        return ((n.memoizedState = [i, t]), i);
      },
      useReducer: function (e, t, n) {
        var i = Ne();
        if (n !== void 0) {
          var a = n(t);
          if (Jn) {
            sn(!0);
            try {
              n(t);
            } finally {
              sn(!1);
            }
          }
        } else a = t;
        return (
          (i.memoizedState = i.baseState = a),
          (e = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: e, lastRenderedState: a }),
          (i.queue = e),
          (e = e.dispatch = Qp.bind(null, D, e)),
          [i.memoizedState, e]
        );
      },
      useRef: function (e) {
        var t = Ne();
        return ((e = { current: e }), (t.memoizedState = e));
      },
      useState: function (e) {
        e = no(e);
        var t = e.queue,
          n = xg.bind(null, D, t);
        return ((t.dispatch = n), [e.memoizedState, n]);
      },
      useDebugValue: nc,
      useDeferredValue: function (e, t) {
        var n = Ne();
        return ic(n, e, t);
      },
      useTransition: function () {
        var e = no(!1);
        return ((e = Eg.bind(null, D, e.queue, !0, !1)), (Ne().memoizedState = e), [!1, e]);
      },
      useSyncExternalStore: function (e, t, n) {
        var i = D,
          a = Ne();
        if (L) {
          if (n === void 0) throw Error(p(407));
          n = n();
        } else {
          if (((n = t()), V === null)) throw Error(p(349));
          (M & 127) !== 0 || ag(i, t, n);
        }
        a.memoizedState = n;
        var l = { value: n, getSnapshot: t };
        return (
          (a.queue = l),
          gd(rg.bind(null, i, l, e), [e]),
          (i.flags |= 2048),
          $i(9, { destroy: void 0 }, lg.bind(null, i, l, n, t), null),
          n
        );
      },
      useId: function () {
        var e = Ne(),
          t = V.identifierPrefix;
        if (L) {
          var n = _t,
            i = pt;
          ((n = (i & ~(1 << (32 - Xe(i) - 1))).toString(32) + n),
            (t = "_" + t + "R_" + n),
            (n = xr++),
            0 < n && (t += "H" + n.toString(32)),
            (t += "_"));
        } else ((n = Bp++), (t = "_" + t + "r_" + n.toString(32) + "_"));
        return (e.memoizedState = t);
      },
      useHostTransitionStatus: ac,
      useFormState: fd,
      useActionState: fd,
      useOptimistic: function (e) {
        var t = Ne();
        t.memoizedState = t.baseState = e;
        var n = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: null, lastRenderedState: null };
        return ((t.queue = n), (t = lc.bind(null, D, !0, n)), (n.dispatch = t), [e, t]);
      },
      useMemoCache: Po,
      useCacheRefresh: function () {
        return (Ne().memoizedState = Xp.bind(null, D));
      },
      useEffectEvent: function (e) {
        var t = Ne(),
          n = { impl: e };
        return (
          (t.memoizedState = n),
          function () {
            if ((H & 2) !== 0) throw Error(p(440));
            return n.impl.apply(void 0, arguments);
          }
        );
      },
    },
    rc = {
      readContext: Ee,
      use: Fr,
      useCallback: bg,
      useContext: Ee,
      useEffect: tc,
      useImperativeHandle: _g,
      useInsertionEffect: mg,
      useLayoutEffect: vg,
      useMemo: wg,
      useReducer: rr,
      useRef: gg,
      useState: function () {
        return rr(It);
      },
      useDebugValue: nc,
      useDeferredValue: function (e, t) {
        var n = ue();
        return Sg(n, I.memoizedState, e, t);
      },
      useTransition: function () {
        var e = rr(It)[0],
          t = ue().memoizedState;
        return [typeof e == "boolean" ? e : vl(e), t];
      },
      useSyncExternalStore: ig,
      useId: Tg,
      useHostTransitionStatus: ac,
      useFormState: dd,
      useActionState: dd,
      useOptimistic: function (e, t) {
        var n = ue();
        return og(n, I, e, t);
      },
      useMemoCache: Po,
      useCacheRefresh: Og,
    };
  rc.useEffectEvent = yg;
  var Ng = {
    readContext: Ee,
    use: Fr,
    useCallback: bg,
    useContext: Ee,
    useEffect: tc,
    useImperativeHandle: _g,
    useInsertionEffect: mg,
    useLayoutEffect: vg,
    useMemo: wg,
    useReducer: du,
    useRef: gg,
    useState: function () {
      return du(It);
    },
    useDebugValue: nc,
    useDeferredValue: function (e, t) {
      var n = ue();
      return I === null ? ic(n, e, t) : Sg(n, I.memoizedState, e, t);
    },
    useTransition: function () {
      var e = du(It)[0],
        t = ue().memoizedState;
      return [typeof e == "boolean" ? e : vl(e), t];
    },
    useSyncExternalStore: ig,
    useId: Tg,
    useHostTransitionStatus: ac,
    useFormState: hd,
    useActionState: hd,
    useOptimistic: function (e, t) {
      var n = ue();
      return I !== null ? og(n, I, e, t) : ((n.baseState = e), [e, n.queue.dispatch]);
    },
    useMemoCache: Po,
    useCacheRefresh: Og,
  };
  Ng.useEffectEvent = yg;
  function hu(e, t, n, i) {
    ((t = e.memoizedState),
      (n = n(i, t)),
      (n = n == null ? t : $({}, t, n)),
      (e.memoizedState = n),
      e.lanes === 0 && (e.updateQueue.baseState = n));
  }
  var lo = {
    enqueueSetState: function (e, t, n) {
      e = e._reactInternals;
      var i = Qe(),
        a = gn(i);
      ((a.payload = t), n != null && (a.callback = n), (t = yn(e, a, i)), t !== null && (qe(t, e, i), Ga(t, e, i)));
    },
    enqueueReplaceState: function (e, t, n) {
      e = e._reactInternals;
      var i = Qe(),
        a = gn(i);
      ((a.tag = 1),
        (a.payload = t),
        n != null && (a.callback = n),
        (t = yn(e, a, i)),
        t !== null && (qe(t, e, i), Ga(t, e, i)));
    },
    enqueueForceUpdate: function (e, t) {
      e = e._reactInternals;
      var n = Qe(),
        i = gn(n);
      ((i.tag = 2), t != null && (i.callback = t), (t = yn(e, i, n)), t !== null && (qe(t, e, n), Ga(t, e, n)));
    },
  };
  function yd(e, t, n, i, a, l, r) {
    return (
      (e = e.stateNode),
      typeof e.shouldComponentUpdate == "function"
        ? e.shouldComponentUpdate(i, l, r)
        : t.prototype && t.prototype.isPureReactComponent
          ? !Pa(n, i) || !Pa(a, l)
          : !0
    );
  }
  function md(e, t, n, i) {
    ((e = t.state),
      typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, i),
      typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, i),
      t.state !== e && lo.enqueueReplaceState(t, t.state, null));
  }
  function Zn(e, t) {
    var n = t;
    if ("ref" in t) {
      n = {};
      for (var i in t) i !== "ref" && (n[i] = t[i]);
    }
    if ((e = e.defaultProps)) {
      n === t && (n = $({}, n));
      for (var a in e) n[a] === void 0 && (n[a] = e[a]);
    }
    return n;
  }
  function Dg(e) {
    br(e);
  }
  function zg(e) {
    console.error(e);
  }
  function jg(e) {
    br(e);
  }
  function kr(e, t) {
    try {
      var n = e.onUncaughtError;
      n(t.value, { componentStack: t.stack });
    } catch (i) {
      setTimeout(function () {
        throw i;
      });
    }
  }
  function vd(e, t, n) {
    try {
      var i = e.onCaughtError;
      i(n.value, { componentStack: n.stack, errorBoundary: t.tag === 1 ? t.stateNode : null });
    } catch (a) {
      setTimeout(function () {
        throw a;
      });
    }
  }
  function ro(e, t, n) {
    return (
      (n = gn(n)),
      (n.tag = 3),
      (n.payload = { element: null }),
      (n.callback = function () {
        kr(e, t);
      }),
      n
    );
  }
  function Mg(e) {
    return ((e = gn(e)), (e.tag = 3), e);
  }
  function qg(e, t, n, i) {
    var a = n.type.getDerivedStateFromError;
    if (typeof a == "function") {
      var l = i.value;
      ((e.payload = function () {
        return a(l);
      }),
        (e.callback = function () {
          vd(t, n, i);
        }));
    }
    var r = n.stateNode;
    r !== null &&
      typeof r.componentDidCatch == "function" &&
      (e.callback = function () {
        (vd(t, n, i), typeof a != "function" && (mn === null ? (mn = new Set([this])) : mn.add(this)));
        var s = i.stack;
        this.componentDidCatch(i.value, { componentStack: s !== null ? s : "" });
      });
  }
  function Jp(e, t, n, i, a) {
    if (((n.flags |= 32768), i !== null && typeof i == "object" && typeof i.then == "function")) {
      if (((t = n.alternate), t !== null && aa(t, n, a, !0), (n = Ze.current), n !== null)) {
        switch (n.tag) {
          case 31:
          case 13:
            return (
              rt === null ? zr() : n.alternate === null && ae === 0 && (ae = 3),
              (n.flags &= -257),
              (n.flags |= 65536),
              (n.lanes = a),
              i === Ar
                ? (n.flags |= 16384)
                : ((t = n.updateQueue), t === null ? (n.updateQueue = new Set([i])) : t.add(i), Au(e, i, a)),
              !1
            );
          case 22:
            return (
              (n.flags |= 65536),
              i === Ar
                ? (n.flags |= 16384)
                : ((t = n.updateQueue),
                  t === null
                    ? ((t = { transitions: null, markerInstances: null, retryQueue: new Set([i]) }),
                      (n.updateQueue = t))
                    : ((n = t.retryQueue), n === null ? (t.retryQueue = new Set([i])) : n.add(i)),
                  Au(e, i, a)),
              !1
            );
        }
        throw Error(p(435, n.tag));
      }
      return (Au(e, i, a), zr(), !1);
    }
    if (L)
      return (
        (t = Ze.current),
        t !== null
          ? ((t.flags & 65536) === 0 && (t.flags |= 256),
            (t.flags |= 65536),
            (t.lanes = a),
            i !== Qu && ((e = Error(p(422), { cause: i })), tl(at(e, n))))
          : (i !== Qu && ((t = Error(p(423), { cause: i })), tl(at(t, n))),
            (e = e.current.alternate),
            (e.flags |= 65536),
            (a &= -a),
            (e.lanes |= a),
            (i = at(i, n)),
            (a = ro(e.stateNode, i, a)),
            fu(e, a),
            ae !== 4 && (ae = 2)),
        !1
      );
    var l = Error(p(520), { cause: i });
    if (((l = at(l, n)), Qa === null ? (Qa = [l]) : Qa.push(l), ae !== 4 && (ae = 2), t === null)) return !0;
    ((i = at(i, n)), (n = t));
    do {
      switch (n.tag) {
        case 3:
          return ((n.flags |= 65536), (e = a & -a), (n.lanes |= e), (e = ro(n.stateNode, i, e)), fu(n, e), !1);
        case 1:
          if (
            ((t = n.type),
            (l = n.stateNode),
            (n.flags & 128) === 0 &&
              (typeof t.getDerivedStateFromError == "function" ||
                (l !== null && typeof l.componentDidCatch == "function" && (mn === null || !mn.has(l)))))
          )
            return ((n.flags |= 65536), (a &= -a), (n.lanes |= a), (a = Mg(a)), qg(a, e, n, i), fu(n, a), !1);
      }
      n = n.return;
    } while (n !== null);
    return !1;
  }
  var sc = Error(p(461)),
    de = !1;
  function be(e, t, n, i) {
    t.child = e === null ? Wh(t, null, n, i) : Qn(t, e.child, n, i);
  }
  function pd(e, t, n, i, a) {
    n = n.render;
    var l = t.ref;
    if ("ref" in i) {
      var r = {};
      for (var s in i) s !== "ref" && (r[s] = i[s]);
    } else r = i;
    return (
      Xn(t),
      (i = Zo(e, t, n, r, l, a)),
      (s = $o()),
      e !== null && !de ? (Wo(e, t, a), Vt(e, t, a)) : (L && s && Go(t), (t.flags |= 1), be(e, t, i, a), t.child)
    );
  }
  function _d(e, t, n, i, a) {
    if (e === null) {
      var l = n.type;
      return typeof l == "function" && !Bo(l) && l.defaultProps === void 0 && n.compare === null
        ? ((t.tag = 15), (t.type = l), Lg(e, t, l, i, a))
        : ((e = ar(n.type, null, i, t, t.mode, a)), (e.ref = t.ref), (e.return = t), (t.child = e));
    }
    if (((l = e.child), !uc(e, a))) {
      var r = l.memoizedProps;
      if (((n = n.compare), (n = n !== null ? n : Pa), n(r, i) && e.ref === t.ref)) return Vt(e, t, a);
    }
    return ((t.flags |= 1), (e = Ht(l, i)), (e.ref = t.ref), (e.return = t), (t.child = e));
  }
  function Lg(e, t, n, i, a) {
    if (e !== null) {
      var l = e.memoizedProps;
      if (Pa(l, i) && e.ref === t.ref)
        if (((de = !1), (t.pendingProps = i = l), uc(e, a))) (e.flags & 131072) !== 0 && (de = !0);
        else return ((t.lanes = e.lanes), Vt(e, t, a));
    }
    return so(e, t, n, i, a);
  }
  function Hg(e, t, n, i) {
    var a = i.children,
      l = e !== null ? e.memoizedState : null;
    if (
      (e === null &&
        t.stateNode === null &&
        (t.stateNode = { _visibility: 1, _pendingMarkers: null, _retryCache: null, _transitions: null }),
      i.mode === "hidden")
    ) {
      if ((t.flags & 128) !== 0) {
        if (((l = l !== null ? l.baseLanes | n : n), e !== null)) {
          for (i = t.child = e.child, a = 0; i !== null;) ((a = a | i.lanes | i.childLanes), (i = i.sibling));
          i = a & ~l;
        } else ((i = 0), (t.child = null));
        return bd(e, t, l, n, i);
      }
      if ((n & 536870912) !== 0)
        ((t.memoizedState = { baseLanes: 0, cachePool: null }),
          e !== null && lr(t, l !== null ? l.cachePool : null),
          l !== null ? ud(t, l) : eo(),
          eg(t));
      else return ((i = t.lanes = 536870912), bd(e, t, l !== null ? l.baseLanes | n : n, n, i));
    } else
      l !== null
        ? (lr(t, l.cachePool), ud(t, l), ln(t), (t.memoizedState = null))
        : (e !== null && lr(t, null), eo(), ln(t));
    return (be(e, t, a, n), t.child);
  }
  function ja(e, t) {
    return (
      (e !== null && e.tag === 22) ||
        t.stateNode !== null ||
        (t.stateNode = { _visibility: 1, _pendingMarkers: null, _retryCache: null, _transitions: null }),
      t.sibling
    );
  }
  function bd(e, t, n, i, a) {
    var l = Io();
    return (
      (l = l === null ? null : { parent: fe._currentValue, pool: l }),
      (t.memoizedState = { baseLanes: n, cachePool: l }),
      e !== null && lr(t, null),
      eo(),
      eg(t),
      e !== null && aa(e, t, i, !0),
      (t.childLanes = a),
      null
    );
  }
  function ur(e, t) {
    return (
      (t = Cr({ mode: t.mode, children: t.children }, e.mode)),
      (t.ref = e.ref),
      (e.child = t),
      (t.return = e),
      t
    );
  }
  function wd(e, t, n) {
    return (Qn(t, e.child, null, n), (e = ur(t, t.pendingProps)), (e.flags |= 2), Ge(t), (t.memoizedState = null), e);
  }
  function Zp(e, t, n) {
    var i = t.pendingProps,
      a = (t.flags & 128) !== 0;
    if (((t.flags &= -129), e === null)) {
      if (L) {
        if (i.mode === "hidden") return ((e = ur(t, i)), (t.lanes = 536870912), ja(null, e));
        if (
          (to(t),
          (e = Z)
            ? ((e = Uy(e, lt)),
              (e = e !== null && e.data === "&" ? e : null),
              e !== null &&
                ((t.memoizedState = {
                  dehydrated: e,
                  treeContext: wn !== null ? { id: pt, overflow: _t } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (n = Ih(e)),
                (n.return = t),
                (t.child = n),
                (Se = t),
                (Z = null)))
            : (e = null),
          e === null)
        )
          throw Sn(t);
        return ((t.lanes = 536870912), null);
      }
      return ur(t, i);
    }
    var l = e.memoizedState;
    if (l !== null) {
      var r = l.dehydrated;
      if ((to(t), a))
        if (t.flags & 256) ((t.flags &= -257), (t = wd(e, t, n)));
        else if (t.memoizedState !== null) ((t.child = e.child), (t.flags |= 128), (t = null));
        else throw Error(p(558));
      else if ((de || aa(e, t, n, !1), (a = (n & e.childLanes) !== 0), de || a)) {
        if (((i = V), i !== null && ((r = mh(i, n)), r !== 0 && r !== l.retryLane)))
          throw ((l.retryLane = r), Pn(e, r), qe(i, e, r), sc);
        (zr(), (t = wd(e, t, n)));
      } else
        ((e = l.treeContext),
          (Z = st(r.nextSibling)),
          (Se = t),
          (L = !0),
          (hn = null),
          (lt = !1),
          e !== null && Xh(t, e),
          (t = ur(t, i)),
          (t.flags |= 4096));
      return t;
    }
    return (
      (e = Ht(e.child, { mode: i.mode, children: i.children })),
      (e.ref = t.ref),
      (t.child = e),
      (e.return = t),
      e
    );
  }
  function or(e, t) {
    var n = t.ref;
    if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
    else {
      if (typeof n != "function" && typeof n != "object") throw Error(p(284));
      (e === null || e.ref !== n) && (t.flags |= 4194816);
    }
  }
  function so(e, t, n, i, a) {
    return (
      Xn(t),
      (n = Zo(e, t, n, i, void 0, a)),
      (i = $o()),
      e !== null && !de ? (Wo(e, t, a), Vt(e, t, a)) : (L && i && Go(t), (t.flags |= 1), be(e, t, n, a), t.child)
    );
  }
  function Sd(e, t, n, i, a, l) {
    return (
      Xn(t),
      (t.updateQueue = null),
      (n = ng(t, i, n, a)),
      tg(e),
      (i = $o()),
      e !== null && !de ? (Wo(e, t, l), Vt(e, t, l)) : (L && i && Go(t), (t.flags |= 1), be(e, t, n, l), t.child)
    );
  }
  function Ed(e, t, n, i, a) {
    if ((Xn(t), t.stateNode === null)) {
      var l = zi,
        r = n.contextType;
      (typeof r == "object" && r !== null && (l = Ee(r)),
        (l = new n(i, l)),
        (t.memoizedState = l.state !== null && l.state !== void 0 ? l.state : null),
        (l.updater = lo),
        (t.stateNode = l),
        (l._reactInternals = t),
        (l = t.stateNode),
        (l.props = i),
        (l.state = t.memoizedState),
        (l.refs = {}),
        Xo(t),
        (r = n.contextType),
        (l.context = typeof r == "object" && r !== null ? Ee(r) : zi),
        (l.state = t.memoizedState),
        (r = n.getDerivedStateFromProps),
        typeof r == "function" && (hu(t, n, r, i), (l.state = t.memoizedState)),
        typeof n.getDerivedStateFromProps == "function" ||
          typeof l.getSnapshotBeforeUpdate == "function" ||
          (typeof l.UNSAFE_componentWillMount != "function" && typeof l.componentWillMount != "function") ||
          ((r = l.state),
          typeof l.componentWillMount == "function" && l.componentWillMount(),
          typeof l.UNSAFE_componentWillMount == "function" && l.UNSAFE_componentWillMount(),
          r !== l.state && lo.enqueueReplaceState(l, l.state, null),
          Ya(t, i, l, a),
          Ka(),
          (l.state = t.memoizedState)),
        typeof l.componentDidMount == "function" && (t.flags |= 4194308),
        (i = !0));
    } else if (e === null) {
      l = t.stateNode;
      var s = t.memoizedProps,
        u = Zn(n, s);
      l.props = u;
      var o = l.context,
        f = n.contextType;
      ((r = zi), typeof f == "object" && f !== null && (r = Ee(f)));
      var m = n.getDerivedStateFromProps;
      ((f = typeof m == "function" || typeof l.getSnapshotBeforeUpdate == "function"),
        (s = t.pendingProps !== s),
        f ||
          (typeof l.UNSAFE_componentWillReceiveProps != "function" &&
            typeof l.componentWillReceiveProps != "function") ||
          ((s || o !== r) && md(t, l, i, r)),
        (tn = !1));
      var d = t.memoizedState;
      ((l.state = d),
        Ya(t, i, l, a),
        Ka(),
        (o = t.memoizedState),
        s || d !== o || tn
          ? (typeof m == "function" && (hu(t, n, m, i), (o = t.memoizedState)),
            (u = tn || yd(t, n, u, i, d, o, r))
              ? (f ||
                  (typeof l.UNSAFE_componentWillMount != "function" && typeof l.componentWillMount != "function") ||
                  (typeof l.componentWillMount == "function" && l.componentWillMount(),
                  typeof l.UNSAFE_componentWillMount == "function" && l.UNSAFE_componentWillMount()),
                typeof l.componentDidMount == "function" && (t.flags |= 4194308))
              : (typeof l.componentDidMount == "function" && (t.flags |= 4194308),
                (t.memoizedProps = i),
                (t.memoizedState = o)),
            (l.props = i),
            (l.state = o),
            (l.context = r),
            (i = u))
          : (typeof l.componentDidMount == "function" && (t.flags |= 4194308), (i = !1)));
    } else {
      ((l = t.stateNode),
        Fu(e, t),
        (r = t.memoizedProps),
        (f = Zn(n, r)),
        (l.props = f),
        (m = t.pendingProps),
        (d = l.context),
        (o = n.contextType),
        (u = zi),
        typeof o == "object" && o !== null && (u = Ee(o)),
        (s = n.getDerivedStateFromProps),
        (o = typeof s == "function" || typeof l.getSnapshotBeforeUpdate == "function") ||
          (typeof l.UNSAFE_componentWillReceiveProps != "function" &&
            typeof l.componentWillReceiveProps != "function") ||
          ((r !== m || d !== u) && md(t, l, i, u)),
        (tn = !1),
        (d = t.memoizedState),
        (l.state = d),
        Ya(t, i, l, a),
        Ka());
      var g = t.memoizedState;
      r !== m || d !== g || tn || (e !== null && e.dependencies !== null && Er(e.dependencies))
        ? (typeof s == "function" && (hu(t, n, s, i), (g = t.memoizedState)),
          (f = tn || yd(t, n, f, i, d, g, u) || (e !== null && e.dependencies !== null && Er(e.dependencies)))
            ? (o ||
                (typeof l.UNSAFE_componentWillUpdate != "function" && typeof l.componentWillUpdate != "function") ||
                (typeof l.componentWillUpdate == "function" && l.componentWillUpdate(i, g, u),
                typeof l.UNSAFE_componentWillUpdate == "function" && l.UNSAFE_componentWillUpdate(i, g, u)),
              typeof l.componentDidUpdate == "function" && (t.flags |= 4),
              typeof l.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024))
            : (typeof l.componentDidUpdate != "function" ||
                (r === e.memoizedProps && d === e.memoizedState) ||
                (t.flags |= 4),
              typeof l.getSnapshotBeforeUpdate != "function" ||
                (r === e.memoizedProps && d === e.memoizedState) ||
                (t.flags |= 1024),
              (t.memoizedProps = i),
              (t.memoizedState = g)),
          (l.props = i),
          (l.state = g),
          (l.context = u),
          (i = f))
        : (typeof l.componentDidUpdate != "function" ||
            (r === e.memoizedProps && d === e.memoizedState) ||
            (t.flags |= 4),
          typeof l.getSnapshotBeforeUpdate != "function" ||
            (r === e.memoizedProps && d === e.memoizedState) ||
            (t.flags |= 1024),
          (i = !1));
    }
    return (
      (l = i),
      or(e, t),
      (i = (t.flags & 128) !== 0),
      l || i
        ? ((l = t.stateNode),
          (n = i && typeof n.getDerivedStateFromError != "function" ? null : l.render()),
          (t.flags |= 1),
          e !== null && i ? ((t.child = Qn(t, e.child, null, a)), (t.child = Qn(t, null, n, a))) : be(e, t, n, a),
          (t.memoizedState = l.state),
          (e = t.child))
        : (e = Vt(e, t, a)),
      e
    );
  }
  function Ad(e, t, n, i) {
    return (Vn(), (t.flags |= 256), be(e, t, n, i), t.child);
  }
  var gu = { dehydrated: null, treeContext: null, retryLane: 0, hydrationErrors: null };
  function yu(e) {
    return { baseLanes: e, cachePool: Jh() };
  }
  function mu(e, t, n) {
    return ((e = e !== null ? e.childLanes & ~n : 0), t && (e |= Ye), e);
  }
  function Bg(e, t, n) {
    var i = t.pendingProps,
      a = !1,
      l = (t.flags & 128) !== 0,
      r;
    if (
      ((r = l) || (r = e !== null && e.memoizedState === null ? !1 : (se.current & 2) !== 0),
      r && ((a = !0), (t.flags &= -129)),
      (r = (t.flags & 32) !== 0),
      (t.flags &= -33),
      e === null)
    ) {
      if (L) {
        if (
          (a ? an(t) : ln(t),
          (e = Z)
            ? ((e = Uy(e, lt)),
              (e = e !== null && e.data !== "&" ? e : null),
              e !== null &&
                ((t.memoizedState = {
                  dehydrated: e,
                  treeContext: wn !== null ? { id: pt, overflow: _t } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (n = Ih(e)),
                (n.return = t),
                (t.child = n),
                (Se = t),
                (Z = null)))
            : (e = null),
          e === null)
        )
          throw Sn(t);
        return (So(e) ? (t.lanes = 32) : (t.lanes = 536870912), null);
      }
      var s = i.children;
      return (
        (i = i.fallback),
        a
          ? (ln(t),
            (a = t.mode),
            (s = Cr({ mode: "hidden", children: s }, a)),
            (i = Gn(i, a, n, null)),
            (s.return = t),
            (i.return = t),
            (s.sibling = i),
            (t.child = s),
            (i = t.child),
            (i.memoizedState = yu(n)),
            (i.childLanes = mu(e, r, n)),
            (t.memoizedState = gu),
            ja(null, i))
          : (an(t), uo(t, s))
      );
    }
    var u = e.memoizedState;
    if (u !== null && ((s = u.dehydrated), s !== null)) {
      if (l)
        t.flags & 256
          ? (an(t), (t.flags &= -257), (t = vu(e, t, n)))
          : t.memoizedState !== null
            ? (ln(t), (t.child = e.child), (t.flags |= 128), (t = null))
            : (ln(t),
              (s = i.fallback),
              (a = t.mode),
              (i = Cr({ mode: "visible", children: i.children }, a)),
              (s = Gn(s, a, n, null)),
              (s.flags |= 2),
              (i.return = t),
              (s.return = t),
              (i.sibling = s),
              (t.child = i),
              Qn(t, e.child, null, n),
              (i = t.child),
              (i.memoizedState = yu(n)),
              (i.childLanes = mu(e, r, n)),
              (t.memoizedState = gu),
              (t = ja(null, i)));
      else if ((an(t), So(s))) {
        if (((r = s.nextSibling && s.nextSibling.dataset), r)) var o = r.dgst;
        ((r = o),
          (i = Error(p(419))),
          (i.stack = ""),
          (i.digest = r),
          tl({ value: i, source: null, stack: null }),
          (t = vu(e, t, n)));
      } else if ((de || aa(e, t, n, !1), (r = (n & e.childLanes) !== 0), de || r)) {
        if (((r = V), r !== null && ((i = mh(r, n)), i !== 0 && i !== u.retryLane)))
          throw ((u.retryLane = i), Pn(e, i), qe(r, e, i), sc);
        (wo(s) || zr(), (t = vu(e, t, n)));
      } else
        wo(s)
          ? ((t.flags |= 192), (t.child = e.child), (t = null))
          : ((e = u.treeContext),
            (Z = st(s.nextSibling)),
            (Se = t),
            (L = !0),
            (hn = null),
            (lt = !1),
            e !== null && Xh(t, e),
            (t = uo(t, i.children)),
            (t.flags |= 4096));
      return t;
    }
    return a
      ? (ln(t),
        (s = i.fallback),
        (a = t.mode),
        (u = e.child),
        (o = u.sibling),
        (i = Ht(u, { mode: "hidden", children: i.children })),
        (i.subtreeFlags = u.subtreeFlags & 65011712),
        o !== null ? (s = Ht(o, s)) : ((s = Gn(s, a, n, null)), (s.flags |= 2)),
        (s.return = t),
        (i.return = t),
        (i.sibling = s),
        (t.child = i),
        ja(null, i),
        (i = t.child),
        (s = e.child.memoizedState),
        s === null
          ? (s = yu(n))
          : ((a = s.cachePool),
            a !== null ? ((u = fe._currentValue), (a = a.parent !== u ? { parent: u, pool: u } : a)) : (a = Jh()),
            (s = { baseLanes: s.baseLanes | n, cachePool: a })),
        (i.memoizedState = s),
        (i.childLanes = mu(e, r, n)),
        (t.memoizedState = gu),
        ja(e.child, i))
      : (an(t),
        (n = e.child),
        (e = n.sibling),
        (n = Ht(n, { mode: "visible", children: i.children })),
        (n.return = t),
        (n.sibling = null),
        e !== null && ((r = t.deletions), r === null ? ((t.deletions = [e]), (t.flags |= 16)) : r.push(e)),
        (t.child = n),
        (t.memoizedState = null),
        n);
  }
  function uo(e, t) {
    return ((t = Cr({ mode: "visible", children: t }, e.mode)), (t.return = e), (e.child = t));
  }
  function Cr(e, t) {
    return ((e = Ke(22, e, null, t)), (e.lanes = 0), e);
  }
  function vu(e, t, n) {
    return (Qn(t, e.child, null, n), (e = uo(t, t.pendingProps.children)), (e.flags |= 2), (t.memoizedState = null), e);
  }
  function Rd(e, t, n) {
    e.lanes |= t;
    var i = e.alternate;
    (i !== null && (i.lanes |= t), Zu(e.return, t, n));
  }
  function pu(e, t, n, i, a, l) {
    var r = e.memoizedState;
    r === null
      ? (e.memoizedState = {
          isBackwards: t,
          rendering: null,
          renderingStartTime: 0,
          last: i,
          tail: n,
          tailMode: a,
          treeForkCount: l,
        })
      : ((r.isBackwards = t),
        (r.rendering = null),
        (r.renderingStartTime = 0),
        (r.last = i),
        (r.tail = n),
        (r.tailMode = a),
        (r.treeForkCount = l));
  }
  function Gg(e, t, n) {
    var i = t.pendingProps,
      a = i.revealOrder,
      l = i.tail;
    i = i.children;
    var r = se.current,
      s = (r & 2) !== 0;
    if (
      (s ? ((r = (r & 1) | 2), (t.flags |= 128)) : (r &= 1),
      X(se, r),
      be(e, t, i, n),
      (i = L ? el : 0),
      !s && e !== null && (e.flags & 128) !== 0)
    )
      e: for (e = t.child; e !== null;) {
        if (e.tag === 13) e.memoizedState !== null && Rd(e, n, t);
        else if (e.tag === 19) Rd(e, n, t);
        else if (e.child !== null) {
          ((e.child.return = e), (e = e.child));
          continue;
        }
        if (e === t) break e;
        for (; e.sibling === null;) {
          if (e.return === null || e.return === t) break e;
          e = e.return;
        }
        ((e.sibling.return = e.return), (e = e.sibling));
      }
    switch (a) {
      case "forwards":
        for (n = t.child, a = null; n !== null;)
          ((e = n.alternate), e !== null && Tr(e) === null && (a = n), (n = n.sibling));
        ((n = a),
          n === null ? ((a = t.child), (t.child = null)) : ((a = n.sibling), (n.sibling = null)),
          pu(t, !1, a, n, l, i));
        break;
      case "backwards":
      case "unstable_legacy-backwards":
        for (n = null, a = t.child, t.child = null; a !== null;) {
          if (((e = a.alternate), e !== null && Tr(e) === null)) {
            t.child = a;
            break;
          }
          ((e = a.sibling), (a.sibling = n), (n = a), (a = e));
        }
        pu(t, !0, n, null, l, i);
        break;
      case "together":
        pu(t, !1, null, null, void 0, i);
        break;
      default:
        t.memoizedState = null;
    }
    return t.child;
  }
  function Vt(e, t, n) {
    if ((e !== null && (t.dependencies = e.dependencies), (An |= t.lanes), (n & t.childLanes) === 0))
      if (e !== null) {
        if ((aa(e, t, n, !1), (n & t.childLanes) === 0)) return null;
      } else return null;
    if (e !== null && t.child !== e.child) throw Error(p(153));
    if (t.child !== null) {
      for (e = t.child, n = Ht(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;)
        ((e = e.sibling), (n = n.sibling = Ht(e, e.pendingProps)), (n.return = t));
      n.sibling = null;
    }
    return t.child;
  }
  function uc(e, t) {
    return (e.lanes & t) !== 0 ? !0 : ((e = e.dependencies), !!(e !== null && Er(e)));
  }
  function $p(e, t, n) {
    switch (t.tag) {
      case 3:
        (mr(t, t.stateNode.containerInfo), nn(t, fe, e.memoizedState.cache), Vn());
        break;
      case 27:
      case 5:
        Mu(t);
        break;
      case 4:
        mr(t, t.stateNode.containerInfo);
        break;
      case 10:
        nn(t, t.type, t.memoizedProps.value);
        break;
      case 31:
        if (t.memoizedState !== null) return ((t.flags |= 128), to(t), null);
        break;
      case 13:
        var i = t.memoizedState;
        if (i !== null)
          return i.dehydrated !== null
            ? (an(t), (t.flags |= 128), null)
            : (n & t.child.childLanes) !== 0
              ? Bg(e, t, n)
              : (an(t), (e = Vt(e, t, n)), e !== null ? e.sibling : null);
        an(t);
        break;
      case 19:
        var a = (e.flags & 128) !== 0;
        if (((i = (n & t.childLanes) !== 0), i || (aa(e, t, n, !1), (i = (n & t.childLanes) !== 0)), a)) {
          if (i) return Gg(e, t, n);
          t.flags |= 128;
        }
        if (
          ((a = t.memoizedState),
          a !== null && ((a.rendering = null), (a.tail = null), (a.lastEffect = null)),
          X(se, se.current),
          i)
        )
          break;
        return null;
      case 22:
        return ((t.lanes = 0), Hg(e, t, n, t.pendingProps));
      case 24:
        nn(t, fe, e.memoizedState.cache);
    }
    return Vt(e, t, n);
  }
  function Kg(e, t, n) {
    if (e !== null)
      if (e.memoizedProps !== t.pendingProps) de = !0;
      else {
        if (!uc(e, n) && (t.flags & 128) === 0) return ((de = !1), $p(e, t, n));
        de = (e.flags & 131072) !== 0;
      }
    else ((de = !1), L && (t.flags & 1048576) !== 0 && Vh(t, el, t.index));
    switch (((t.lanes = 0), t.tag)) {
      case 16:
        e: {
          var i = t.pendingProps;
          if (((e = Ln(t.elementType)), (t.type = e), typeof e == "function"))
            Bo(e)
              ? ((i = Zn(e, i)), (t.tag = 1), (t = Ed(null, t, e, i, n)))
              : ((t.tag = 0), (t = so(null, t, e, i, n)));
          else {
            if (e != null) {
              var a = e.$$typeof;
              if (a === To) {
                ((t.tag = 11), (t = pd(null, t, e, i, n)));
                break e;
              } else if (a === Oo) {
                ((t.tag = 14), (t = _d(null, t, e, i, n)));
                break e;
              }
            }
            throw ((t = zu(e) || e), Error(p(306, t, "")));
          }
        }
        return t;
      case 0:
        return so(e, t, t.type, t.pendingProps, n);
      case 1:
        return ((i = t.type), (a = Zn(i, t.pendingProps)), Ed(e, t, i, a, n));
      case 3:
        e: {
          if ((mr(t, t.stateNode.containerInfo), e === null)) throw Error(p(387));
          i = t.pendingProps;
          var l = t.memoizedState;
          ((a = l.element), Fu(e, t), Ya(t, i, null, n));
          var r = t.memoizedState;
          if (((i = r.cache), nn(t, fe, i), i !== l.cache && $u(t, [fe], n, !0), Ka(), (i = r.element), l.isDehydrated))
            if (
              ((l = { element: i, isDehydrated: !1, cache: r.cache }),
              (t.updateQueue.baseState = l),
              (t.memoizedState = l),
              t.flags & 256)
            ) {
              t = Ad(e, t, i, n);
              break e;
            } else if (i !== a) {
              ((a = at(Error(p(424)), t)), tl(a), (t = Ad(e, t, i, n)));
              break e;
            } else {
              switch (((e = t.stateNode.containerInfo), e.nodeType)) {
                case 9:
                  e = e.body;
                  break;
                default:
                  e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
              }
              for (Z = st(e.firstChild), Se = t, L = !0, hn = null, lt = !0, n = Wh(t, null, i, n), t.child = n; n;)
                ((n.flags = (n.flags & -3) | 4096), (n = n.sibling));
            }
          else {
            if ((Vn(), i === a)) {
              t = Vt(e, t, n);
              break e;
            }
            be(e, t, i, n);
          }
          t = t.child;
        }
        return t;
      case 26:
        return (
          or(e, t),
          e === null
            ? (n = Qd(t.type, null, t.pendingProps, null))
              ? (t.memoizedState = n)
              : L ||
                ((n = t.type),
                (e = t.pendingProps),
                (i = Lr(dn.current).createElement(n)),
                (i[we] = t),
                (i[Le] = e),
                Ae(i, n, e),
                ve(i),
                (t.stateNode = i))
            : (t.memoizedState = Qd(t.type, e.memoizedProps, t.pendingProps, e.memoizedState)),
          null
        );
      case 27:
        return (
          Mu(t),
          e === null &&
            L &&
            ((i = t.stateNode = Ny(t.type, t.pendingProps, dn.current)),
            (Se = t),
            (lt = !0),
            (a = Z),
            Tn(t.type) ? ((Eo = a), (Z = st(i.firstChild))) : (Z = a)),
          be(e, t, t.pendingProps.children, n),
          or(e, t),
          e === null && (t.flags |= 4194304),
          t.child
        );
      case 5:
        return (
          e === null &&
            L &&
            ((a = i = Z) &&
              ((i = A0(i, t.type, t.pendingProps, lt)),
              i !== null ? ((t.stateNode = i), (Se = t), (Z = st(i.firstChild)), (lt = !1), (a = !0)) : (a = !1)),
            a || Sn(t)),
          Mu(t),
          (a = t.type),
          (l = t.pendingProps),
          (r = e !== null ? e.memoizedProps : null),
          (i = l.children),
          _o(a, l) ? (i = null) : r !== null && _o(a, r) && (t.flags |= 32),
          t.memoizedState !== null && ((a = Zo(e, t, Gp, null, null, n)), (sl._currentValue = a)),
          or(e, t),
          be(e, t, i, n),
          t.child
        );
      case 6:
        return (
          e === null &&
            L &&
            ((e = n = Z) &&
              ((n = R0(n, t.pendingProps, lt)),
              n !== null ? ((t.stateNode = n), (Se = t), (Z = null), (e = !0)) : (e = !1)),
            e || Sn(t)),
          null
        );
      case 13:
        return Bg(e, t, n);
      case 4:
        return (
          mr(t, t.stateNode.containerInfo),
          (i = t.pendingProps),
          e === null ? (t.child = Qn(t, null, i, n)) : be(e, t, i, n),
          t.child
        );
      case 11:
        return pd(e, t, t.type, t.pendingProps, n);
      case 7:
        return (be(e, t, t.pendingProps, n), t.child);
      case 8:
        return (be(e, t, t.pendingProps.children, n), t.child);
      case 12:
        return (be(e, t, t.pendingProps.children, n), t.child);
      case 10:
        return ((i = t.pendingProps), nn(t, t.type, i.value), be(e, t, i.children, n), t.child);
      case 9:
        return (
          (a = t.type._context),
          (i = t.pendingProps.children),
          Xn(t),
          (a = Ee(a)),
          (i = i(a)),
          (t.flags |= 1),
          be(e, t, i, n),
          t.child
        );
      case 14:
        return _d(e, t, t.type, t.pendingProps, n);
      case 15:
        return Lg(e, t, t.type, t.pendingProps, n);
      case 19:
        return Gg(e, t, n);
      case 31:
        return Zp(e, t, n);
      case 22:
        return Hg(e, t, n, t.pendingProps);
      case 24:
        return (
          Xn(t),
          (i = Ee(fe)),
          e === null
            ? ((a = Io()),
              a === null &&
                ((a = V),
                (l = Yo()),
                (a.pooledCache = l),
                l.refCount++,
                l !== null && (a.pooledCacheLanes |= n),
                (a = l)),
              (t.memoizedState = { parent: i, cache: a }),
              Xo(t),
              nn(t, fe, a))
            : ((e.lanes & n) !== 0 && (Fu(e, t), Ya(t, null, null, n), Ka()),
              (a = e.memoizedState),
              (l = t.memoizedState),
              a.parent !== i
                ? ((a = { parent: i, cache: i }),
                  (t.memoizedState = a),
                  t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = a),
                  nn(t, fe, i))
                : ((i = l.cache), nn(t, fe, i), i !== a.cache && $u(t, [fe], n, !0))),
          be(e, t, t.pendingProps.children, n),
          t.child
        );
      case 29:
        throw t.pendingProps;
    }
    throw Error(p(156, t.tag));
  }
  function Ct(e) {
    e.flags |= 4;
  }
  function _u(e, t, n, i, a) {
    if (((t = (e.mode & 32) !== 0) && (t = !1), t)) {
      if (((e.flags |= 16777216), (a & 335544128) === a))
        if (e.stateNode.complete) e.flags |= 8192;
        else if (dy()) e.flags |= 8192;
        else throw ((Yn = Ar), Vo);
    } else e.flags &= -16777217;
  }
  function Td(e, t) {
    if (t.type !== "stylesheet" || (t.state.loading & 4) !== 0) e.flags &= -16777217;
    else if (((e.flags |= 16777216), !jy(t)))
      if (dy()) e.flags |= 8192;
      else throw ((Yn = Ar), Vo);
  }
  function Ql(e, t) {
    (t !== null && (e.flags |= 4),
      e.flags & 16384 && ((t = e.tag !== 22 ? hh() : 536870912), (e.lanes |= t), (Wi |= t)));
  }
  function xa(e, t) {
    if (!L)
      switch (e.tailMode) {
        case "hidden":
          t = e.tail;
          for (var n = null; t !== null;) (t.alternate !== null && (n = t), (t = t.sibling));
          n === null ? (e.tail = null) : (n.sibling = null);
          break;
        case "collapsed":
          n = e.tail;
          for (var i = null; n !== null;) (n.alternate !== null && (i = n), (n = n.sibling));
          i === null ? (t || e.tail === null ? (e.tail = null) : (e.tail.sibling = null)) : (i.sibling = null);
      }
  }
  function J(e) {
    var t = e.alternate !== null && e.alternate.child === e.child,
      n = 0,
      i = 0;
    if (t)
      for (var a = e.child; a !== null;)
        ((n |= a.lanes | a.childLanes),
          (i |= a.subtreeFlags & 65011712),
          (i |= a.flags & 65011712),
          (a.return = e),
          (a = a.sibling));
    else
      for (a = e.child; a !== null;)
        ((n |= a.lanes | a.childLanes), (i |= a.subtreeFlags), (i |= a.flags), (a.return = e), (a = a.sibling));
    return ((e.subtreeFlags |= i), (e.childLanes = n), t);
  }
  function Wp(e, t, n) {
    var i = t.pendingProps;
    switch ((Ko(t), t.tag)) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return (J(t), null);
      case 1:
        return (J(t), null);
      case 3:
        return (
          (n = t.stateNode),
          (i = null),
          e !== null && (i = e.memoizedState.cache),
          t.memoizedState.cache !== i && (t.flags |= 2048),
          Bt(fe),
          Vi(),
          n.pendingContext && ((n.context = n.pendingContext), (n.pendingContext = null)),
          (e === null || e.child === null) &&
            (Si(t)
              ? Ct(t)
              : e === null || (e.memoizedState.isDehydrated && (t.flags & 256) === 0) || ((t.flags |= 1024), cu())),
          J(t),
          null
        );
      case 26:
        var a = t.type,
          l = t.memoizedState;
        return (
          e === null
            ? (Ct(t), l !== null ? (J(t), Td(t, l)) : (J(t), _u(t, a, null, i, n)))
            : l
              ? l !== e.memoizedState
                ? (Ct(t), J(t), Td(t, l))
                : (J(t), (t.flags &= -16777217))
              : ((e = e.memoizedProps), e !== i && Ct(t), J(t), _u(t, a, e, i, n)),
          null
        );
      case 27:
        if ((vr(t), (n = dn.current), (a = t.type), e !== null && t.stateNode != null)) e.memoizedProps !== i && Ct(t);
        else {
          if (!i) {
            if (t.stateNode === null) throw Error(p(166));
            return (J(t), null);
          }
          ((e = wt.current), Si(t) ? td(t, e) : ((e = Ny(a, i, n)), (t.stateNode = e), Ct(t)));
        }
        return (J(t), null);
      case 5:
        if ((vr(t), (a = t.type), e !== null && t.stateNode != null)) e.memoizedProps !== i && Ct(t);
        else {
          if (!i) {
            if (t.stateNode === null) throw Error(p(166));
            return (J(t), null);
          }
          if (((l = wt.current), Si(t))) td(t, l);
          else {
            var r = Lr(dn.current);
            switch (l) {
              case 1:
                l = r.createElementNS("http://www.w3.org/2000/svg", a);
                break;
              case 2:
                l = r.createElementNS("http://www.w3.org/1998/Math/MathML", a);
                break;
              default:
                switch (a) {
                  case "svg":
                    l = r.createElementNS("http://www.w3.org/2000/svg", a);
                    break;
                  case "math":
                    l = r.createElementNS("http://www.w3.org/1998/Math/MathML", a);
                    break;
                  case "script":
                    ((l = r.createElement("div")),
                      (l.innerHTML = "<script><\/script>"),
                      (l = l.removeChild(l.firstChild)));
                    break;
                  case "select":
                    ((l =
                      typeof i.is == "string" ? r.createElement("select", { is: i.is }) : r.createElement("select")),
                      i.multiple ? (l.multiple = !0) : i.size && (l.size = i.size));
                    break;
                  default:
                    l = typeof i.is == "string" ? r.createElement(a, { is: i.is }) : r.createElement(a);
                }
            }
            ((l[we] = t), (l[Le] = i));
            e: for (r = t.child; r !== null;) {
              if (r.tag === 5 || r.tag === 6) l.appendChild(r.stateNode);
              else if (r.tag !== 4 && r.tag !== 27 && r.child !== null) {
                ((r.child.return = r), (r = r.child));
                continue;
              }
              if (r === t) break e;
              for (; r.sibling === null;) {
                if (r.return === null || r.return === t) break e;
                r = r.return;
              }
              ((r.sibling.return = r.return), (r = r.sibling));
            }
            t.stateNode = l;
            e: switch ((Ae(l, a, i), a)) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                i = !!i.autoFocus;
                break e;
              case "img":
                i = !0;
                break e;
              default:
                i = !1;
            }
            i && Ct(t);
          }
        }
        return (J(t), _u(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null);
      case 6:
        if (e && t.stateNode != null) e.memoizedProps !== i && Ct(t);
        else {
          if (typeof i != "string" && t.stateNode === null) throw Error(p(166));
          if (((e = dn.current), Si(t))) {
            if (((e = t.stateNode), (n = t.memoizedProps), (i = null), (a = Se), a !== null))
              switch (a.tag) {
                case 27:
                case 5:
                  i = a.memoizedProps;
              }
            ((e[we] = t),
              (e = !!(e.nodeValue === n || (i !== null && i.suppressHydrationWarning === !0) || xy(e.nodeValue, n))),
              e || Sn(t, !0));
          } else ((e = Lr(e).createTextNode(i)), (e[we] = t), (t.stateNode = e));
        }
        return (J(t), null);
      case 31:
        if (((n = t.memoizedState), e === null || e.memoizedState !== null)) {
          if (((i = Si(t)), n !== null)) {
            if (e === null) {
              if (!i) throw Error(p(318));
              if (((e = t.memoizedState), (e = e !== null ? e.dehydrated : null), !e)) throw Error(p(557));
              e[we] = t;
            } else (Vn(), (t.flags & 128) === 0 && (t.memoizedState = null), (t.flags |= 4));
            (J(t), (e = !1));
          } else
            ((n = cu()), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), (e = !0));
          if (!e) return t.flags & 256 ? (Ge(t), t) : (Ge(t), null);
          if ((t.flags & 128) !== 0) throw Error(p(558));
        }
        return (J(t), null);
      case 13:
        if (((i = t.memoizedState), e === null || (e.memoizedState !== null && e.memoizedState.dehydrated !== null))) {
          if (((a = Si(t)), i !== null && i.dehydrated !== null)) {
            if (e === null) {
              if (!a) throw Error(p(318));
              if (((a = t.memoizedState), (a = a !== null ? a.dehydrated : null), !a)) throw Error(p(317));
              a[we] = t;
            } else (Vn(), (t.flags & 128) === 0 && (t.memoizedState = null), (t.flags |= 4));
            (J(t), (a = !1));
          } else
            ((a = cu()), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = a), (a = !0));
          if (!a) return t.flags & 256 ? (Ge(t), t) : (Ge(t), null);
        }
        return (
          Ge(t),
          (t.flags & 128) !== 0
            ? ((t.lanes = n), t)
            : ((n = i !== null),
              (e = e !== null && e.memoizedState !== null),
              n &&
                ((i = t.child),
                (a = null),
                i.alternate !== null &&
                  i.alternate.memoizedState !== null &&
                  i.alternate.memoizedState.cachePool !== null &&
                  (a = i.alternate.memoizedState.cachePool.pool),
                (l = null),
                i.memoizedState !== null && i.memoizedState.cachePool !== null && (l = i.memoizedState.cachePool.pool),
                l !== a && (i.flags |= 2048)),
              n !== e && n && (t.child.flags |= 8192),
              Ql(t, t.updateQueue),
              J(t),
              null)
        );
      case 4:
        return (Vi(), e === null && yc(t.stateNode.containerInfo), J(t), null);
      case 10:
        return (Bt(t.type), J(t), null);
      case 19:
        if ((pe(se), (i = t.memoizedState), i === null)) return (J(t), null);
        if (((a = (t.flags & 128) !== 0), (l = i.rendering), l === null))
          if (a) xa(i, !1);
          else {
            if (ae !== 0 || (e !== null && (e.flags & 128) !== 0))
              for (e = t.child; e !== null;) {
                if (((l = Tr(e)), l !== null)) {
                  for (
                    t.flags |= 128,
                      xa(i, !1),
                      e = l.updateQueue,
                      t.updateQueue = e,
                      Ql(t, e),
                      t.subtreeFlags = 0,
                      e = n,
                      n = t.child;
                    n !== null;
                  )
                    (Yh(n, e), (n = n.sibling));
                  return (X(se, (se.current & 1) | 2), L && zt(t, i.treeForkCount), t.child);
                }
                e = e.sibling;
              }
            i.tail !== null && Ie() > Nr && ((t.flags |= 128), (a = !0), xa(i, !1), (t.lanes = 4194304));
          }
        else {
          if (!a)
            if (((e = Tr(l)), e !== null)) {
              if (
                ((t.flags |= 128),
                (a = !0),
                (e = e.updateQueue),
                (t.updateQueue = e),
                Ql(t, e),
                xa(i, !0),
                i.tail === null && i.tailMode === "hidden" && !l.alternate && !L)
              )
                return (J(t), null);
            } else
              2 * Ie() - i.renderingStartTime > Nr &&
                n !== 536870912 &&
                ((t.flags |= 128), (a = !0), xa(i, !1), (t.lanes = 4194304));
          i.isBackwards
            ? ((l.sibling = t.child), (t.child = l))
            : ((e = i.last), e !== null ? (e.sibling = l) : (t.child = l), (i.last = l));
        }
        return i.tail !== null
          ? ((e = i.tail),
            (i.rendering = e),
            (i.tail = e.sibling),
            (i.renderingStartTime = Ie()),
            (e.sibling = null),
            (n = se.current),
            X(se, a ? (n & 1) | 2 : n & 1),
            L && zt(t, i.treeForkCount),
            e)
          : (J(t), null);
      case 22:
      case 23:
        return (
          Ge(t),
          Qo(),
          (i = t.memoizedState !== null),
          e !== null ? (e.memoizedState !== null) !== i && (t.flags |= 8192) : i && (t.flags |= 8192),
          i ? (n & 536870912) !== 0 && (t.flags & 128) === 0 && (J(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : J(t),
          (n = t.updateQueue),
          n !== null && Ql(t, n.retryQueue),
          (n = null),
          e !== null &&
            e.memoizedState !== null &&
            e.memoizedState.cachePool !== null &&
            (n = e.memoizedState.cachePool.pool),
          (i = null),
          t.memoizedState !== null && t.memoizedState.cachePool !== null && (i = t.memoizedState.cachePool.pool),
          i !== n && (t.flags |= 2048),
          e !== null && pe(Kn),
          null
        );
      case 24:
        return (
          (n = null),
          e !== null && (n = e.memoizedState.cache),
          t.memoizedState.cache !== n && (t.flags |= 2048),
          Bt(fe),
          J(t),
          null
        );
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(p(156, t.tag));
  }
  function Fp(e, t) {
    switch ((Ko(t), t.tag)) {
      case 1:
        return ((e = t.flags), e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null);
      case 3:
        return (
          Bt(fe),
          Vi(),
          (e = t.flags),
          (e & 65536) !== 0 && (e & 128) === 0 ? ((t.flags = (e & -65537) | 128), t) : null
        );
      case 26:
      case 27:
      case 5:
        return (vr(t), null);
      case 31:
        if (t.memoizedState !== null) {
          if ((Ge(t), t.alternate === null)) throw Error(p(340));
          Vn();
        }
        return ((e = t.flags), e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null);
      case 13:
        if ((Ge(t), (e = t.memoizedState), e !== null && e.dehydrated !== null)) {
          if (t.alternate === null) throw Error(p(340));
          Vn();
        }
        return ((e = t.flags), e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null);
      case 19:
        return (pe(se), null);
      case 4:
        return (Vi(), null);
      case 10:
        return (Bt(t.type), null);
      case 22:
      case 23:
        return (
          Ge(t),
          Qo(),
          e !== null && pe(Kn),
          (e = t.flags),
          e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
        );
      case 24:
        return (Bt(fe), null);
      case 25:
        return null;
      default:
        return null;
    }
  }
  function Yg(e, t) {
    switch ((Ko(t), t.tag)) {
      case 3:
        (Bt(fe), Vi());
        break;
      case 26:
      case 27:
      case 5:
        vr(t);
        break;
      case 4:
        Vi();
        break;
      case 31:
        t.memoizedState !== null && Ge(t);
        break;
      case 13:
        Ge(t);
        break;
      case 19:
        pe(se);
        break;
      case 10:
        Bt(t.type);
        break;
      case 22:
      case 23:
        (Ge(t), Qo(), e !== null && pe(Kn));
        break;
      case 24:
        Bt(fe);
    }
  }
  function pl(e, t) {
    try {
      var n = t.updateQueue,
        i = n !== null ? n.lastEffect : null;
      if (i !== null) {
        var a = i.next;
        n = a;
        do {
          if ((n.tag & e) === e) {
            i = void 0;
            var l = n.create,
              r = n.inst;
            ((i = l()), (r.destroy = i));
          }
          n = n.next;
        } while (n !== a);
      }
    } catch (s) {
      K(t, t.return, s);
    }
  }
  function En(e, t, n) {
    try {
      var i = t.updateQueue,
        a = i !== null ? i.lastEffect : null;
      if (a !== null) {
        var l = a.next;
        i = l;
        do {
          if ((i.tag & e) === e) {
            var r = i.inst,
              s = r.destroy;
            if (s !== void 0) {
              ((r.destroy = void 0), (a = t));
              var u = n,
                o = s;
              try {
                o();
              } catch (f) {
                K(a, u, f);
              }
            }
          }
          i = i.next;
        } while (i !== l);
      }
    } catch (f) {
      K(t, t.return, f);
    }
  }
  function Ig(e) {
    var t = e.updateQueue;
    if (t !== null) {
      var n = e.stateNode;
      try {
        Ph(t, n);
      } catch (i) {
        K(e, e.return, i);
      }
    }
  }
  function Vg(e, t, n) {
    ((n.props = Zn(e.type, e.memoizedProps)), (n.state = e.memoizedState));
    try {
      n.componentWillUnmount();
    } catch (i) {
      K(e, t, i);
    }
  }
  function Va(e, t) {
    try {
      var n = e.ref;
      if (n !== null) {
        switch (e.tag) {
          case 26:
          case 27:
          case 5:
            var i = e.stateNode;
            break;
          case 30:
            i = e.stateNode;
            break;
          default:
            i = e.stateNode;
        }
        typeof n == "function" ? (e.refCleanup = n(i)) : (n.current = i);
      }
    } catch (a) {
      K(e, t, a);
    }
  }
  function bt(e, t) {
    var n = e.ref,
      i = e.refCleanup;
    if (n !== null)
      if (typeof i == "function")
        try {
          i();
        } catch (a) {
          K(e, t, a);
        } finally {
          ((e.refCleanup = null), (e = e.alternate), e != null && (e.refCleanup = null));
        }
      else if (typeof n == "function")
        try {
          n(null);
        } catch (a) {
          K(e, t, a);
        }
      else n.current = null;
  }
  function Xg(e) {
    var t = e.type,
      n = e.memoizedProps,
      i = e.stateNode;
    try {
      e: switch (t) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          n.autoFocus && i.focus();
          break e;
        case "img":
          n.src ? (i.src = n.src) : n.srcSet && (i.srcset = n.srcSet);
      }
    } catch (a) {
      K(e, e.return, a);
    }
  }
  function bu(e, t, n) {
    try {
      var i = e.stateNode;
      (p0(i, e.type, n, t), (i[Le] = t));
    } catch (a) {
      K(e, e.return, a);
    }
  }
  function Qg(e) {
    return e.tag === 5 || e.tag === 3 || e.tag === 26 || (e.tag === 27 && Tn(e.type)) || e.tag === 4;
  }
  function wu(e) {
    e: for (;;) {
      for (; e.sibling === null;) {
        if (e.return === null || Qg(e.return)) return null;
        e = e.return;
      }
      for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
        if ((e.tag === 27 && Tn(e.type)) || e.flags & 2 || e.child === null || e.tag === 4) continue e;
        ((e.child.return = e), (e = e.child));
      }
      if (!(e.flags & 2)) return e.stateNode;
    }
  }
  function oo(e, t, n) {
    var i = e.tag;
    if (i === 5 || i === 6)
      ((e = e.stateNode),
        t
          ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(e, t)
          : ((t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n),
            t.appendChild(e),
            (n = n._reactRootContainer),
            n != null || t.onclick !== null || (t.onclick = qt)));
    else if (i !== 4 && (i === 27 && Tn(e.type) && ((n = e.stateNode), (t = null)), (e = e.child), e !== null))
      for (oo(e, t, n), e = e.sibling; e !== null;) (oo(e, t, n), (e = e.sibling));
  }
  function Ur(e, t, n) {
    var i = e.tag;
    if (i === 5 || i === 6) ((e = e.stateNode), t ? n.insertBefore(e, t) : n.appendChild(e));
    else if (i !== 4 && (i === 27 && Tn(e.type) && (n = e.stateNode), (e = e.child), e !== null))
      for (Ur(e, t, n), e = e.sibling; e !== null;) (Ur(e, t, n), (e = e.sibling));
  }
  function Jg(e) {
    var t = e.stateNode,
      n = e.memoizedProps;
    try {
      for (var i = e.type, a = t.attributes; a.length;) t.removeAttributeNode(a[0]);
      (Ae(t, i, n), (t[we] = e), (t[Le] = n));
    } catch (l) {
      K(e, e.return, l);
    }
  }
  var jt = !1,
    ce = !1,
    Su = !1,
    Od = typeof WeakSet == "function" ? WeakSet : Set,
    me = null;
  function Pp(e, t) {
    if (((e = e.containerInfo), (vo = Kr), (e = jh(e)), qo(e))) {
      if ("selectionStart" in e) var n = { start: e.selectionStart, end: e.selectionEnd };
      else
        e: {
          n = ((n = e.ownerDocument) && n.defaultView) || window;
          var i = n.getSelection && n.getSelection();
          if (i && i.rangeCount !== 0) {
            n = i.anchorNode;
            var a = i.anchorOffset,
              l = i.focusNode;
            i = i.focusOffset;
            try {
              (n.nodeType, l.nodeType);
            } catch {
              n = null;
              break e;
            }
            var r = 0,
              s = -1,
              u = -1,
              o = 0,
              f = 0,
              m = e,
              d = null;
            t: for (;;) {
              for (
                var g;
                m !== n || (a !== 0 && m.nodeType !== 3) || (s = r + a),
                  m !== l || (i !== 0 && m.nodeType !== 3) || (u = r + i),
                  m.nodeType === 3 && (r += m.nodeValue.length),
                  (g = m.firstChild) !== null;
              )
                ((d = m), (m = g));
              for (;;) {
                if (m === e) break t;
                if ((d === n && ++o === a && (s = r), d === l && ++f === i && (u = r), (g = m.nextSibling) !== null))
                  break;
                ((m = d), (d = m.parentNode));
              }
              m = g;
            }
            n = s === -1 || u === -1 ? null : { start: s, end: u };
          } else n = null;
        }
      n = n || { start: 0, end: 0 };
    } else n = null;
    for (po = { focusedElem: e, selectionRange: n }, Kr = !1, me = t; me !== null;)
      if (((t = me), (e = t.child), (t.subtreeFlags & 1028) !== 0 && e !== null)) ((e.return = t), (me = e));
      else
        for (; me !== null;) {
          switch (((t = me), (l = t.alternate), (e = t.flags), t.tag)) {
            case 0:
              if ((e & 4) !== 0 && ((e = t.updateQueue), (e = e !== null ? e.events : null), e !== null))
                for (n = 0; n < e.length; n++) ((a = e[n]), (a.ref.impl = a.nextImpl));
              break;
            case 11:
            case 15:
              break;
            case 1:
              if ((e & 1024) !== 0 && l !== null) {
                ((e = void 0), (n = t), (a = l.memoizedProps), (l = l.memoizedState), (i = n.stateNode));
                try {
                  var _ = Zn(n.type, a);
                  ((e = i.getSnapshotBeforeUpdate(_, l)), (i.__reactInternalSnapshotBeforeUpdate = e));
                } catch (b) {
                  K(n, n.return, b);
                }
              }
              break;
            case 3:
              if ((e & 1024) !== 0) {
                if (((e = t.stateNode.containerInfo), (n = e.nodeType), n === 9)) bo(e);
                else if (n === 1)
                  switch (e.nodeName) {
                    case "HEAD":
                    case "HTML":
                    case "BODY":
                      bo(e);
                      break;
                    default:
                      e.textContent = "";
                  }
              }
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if ((e & 1024) !== 0) throw Error(p(163));
          }
          if (((e = t.sibling), e !== null)) {
            ((e.return = t.return), (me = e));
            break;
          }
          me = t.return;
        }
  }
  function Zg(e, t, n) {
    var i = n.flags;
    switch (n.tag) {
      case 0:
      case 11:
      case 15:
        (Nt(e, n), i & 4 && pl(5, n));
        break;
      case 1:
        if ((Nt(e, n), i & 4))
          if (((e = n.stateNode), t === null))
            try {
              e.componentDidMount();
            } catch (r) {
              K(n, n.return, r);
            }
          else {
            var a = Zn(n.type, t.memoizedProps);
            t = t.memoizedState;
            try {
              e.componentDidUpdate(a, t, e.__reactInternalSnapshotBeforeUpdate);
            } catch (r) {
              K(n, n.return, r);
            }
          }
        (i & 64 && Ig(n), i & 512 && Va(n, n.return));
        break;
      case 3:
        if ((Nt(e, n), i & 64 && ((e = n.updateQueue), e !== null))) {
          if (((t = null), n.child !== null))
            switch (n.child.tag) {
              case 27:
              case 5:
                t = n.child.stateNode;
                break;
              case 1:
                t = n.child.stateNode;
            }
          try {
            Ph(e, t);
          } catch (r) {
            K(n, n.return, r);
          }
        }
        break;
      case 27:
        t === null && i & 4 && Jg(n);
      case 26:
      case 5:
        (Nt(e, n), t === null && i & 4 && Xg(n), i & 512 && Va(n, n.return));
        break;
      case 12:
        Nt(e, n);
        break;
      case 31:
        (Nt(e, n), i & 4 && Fg(e, n));
        break;
      case 13:
        (Nt(e, n),
          i & 4 && Pg(e, n),
          i & 64 &&
            ((e = n.memoizedState),
            e !== null && ((e = e.dehydrated), e !== null && ((n = u0.bind(null, n)), T0(e, n)))));
        break;
      case 22:
        if (((i = n.memoizedState !== null || jt), !i)) {
          ((t = (t !== null && t.memoizedState !== null) || ce), (a = jt));
          var l = ce;
          ((jt = i), (ce = t) && !l ? Dt(e, n, (n.subtreeFlags & 8772) !== 0) : Nt(e, n), (jt = a), (ce = l));
        }
        break;
      case 30:
        break;
      default:
        Nt(e, n);
    }
  }
  function $g(e) {
    var t = e.alternate;
    (t !== null && ((e.alternate = null), $g(t)),
      (e.child = null),
      (e.deletions = null),
      (e.sibling = null),
      e.tag === 5 && ((t = e.stateNode), t !== null && Uo(t)),
      (e.stateNode = null),
      (e.return = null),
      (e.dependencies = null),
      (e.memoizedProps = null),
      (e.memoizedState = null),
      (e.pendingProps = null),
      (e.stateNode = null),
      (e.updateQueue = null));
  }
  var F = null,
    je = !1;
  function Ut(e, t, n) {
    for (n = n.child; n !== null;) (Wg(e, t, n), (n = n.sibling));
  }
  function Wg(e, t, n) {
    if (Ve && typeof Ve.onCommitFiberUnmount == "function")
      try {
        Ve.onCommitFiberUnmount(fl, n);
      } catch {}
    switch (n.tag) {
      case 26:
        (ce || bt(n, t),
          Ut(e, t, n),
          n.memoizedState ? n.memoizedState.count-- : n.stateNode && ((n = n.stateNode), n.parentNode.removeChild(n)));
        break;
      case 27:
        ce || bt(n, t);
        var i = F,
          a = je;
        (Tn(n.type) && ((F = n.stateNode), (je = !1)), Ut(e, t, n), Za(n.stateNode), (F = i), (je = a));
        break;
      case 5:
        ce || bt(n, t);
      case 6:
        if (((i = F), (a = je), (F = null), Ut(e, t, n), (F = i), (je = a), F !== null))
          if (je)
            try {
              (F.nodeType === 9 ? F.body : F.nodeName === "HTML" ? F.ownerDocument.body : F).removeChild(n.stateNode);
            } catch (l) {
              K(n, t, l);
            }
          else
            try {
              F.removeChild(n.stateNode);
            } catch (l) {
              K(n, t, l);
            }
        break;
      case 18:
        F !== null &&
          (je
            ? ((e = F),
              Kd(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode),
              ta(e))
            : Kd(F, n.stateNode));
        break;
      case 4:
        ((i = F), (a = je), (F = n.stateNode.containerInfo), (je = !0), Ut(e, t, n), (F = i), (je = a));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        (En(2, n, t), ce || En(4, n, t), Ut(e, t, n));
        break;
      case 1:
        (ce || (bt(n, t), (i = n.stateNode), typeof i.componentWillUnmount == "function" && Vg(n, t, i)), Ut(e, t, n));
        break;
      case 21:
        Ut(e, t, n);
        break;
      case 22:
        ((ce = (i = ce) || n.memoizedState !== null), Ut(e, t, n), (ce = i));
        break;
      default:
        Ut(e, t, n);
    }
  }
  function Fg(e, t) {
    if (t.memoizedState === null && ((e = t.alternate), e !== null && ((e = e.memoizedState), e !== null))) {
      e = e.dehydrated;
      try {
        ta(e);
      } catch (n) {
        K(t, t.return, n);
      }
    }
  }
  function Pg(e, t) {
    if (
      t.memoizedState === null &&
      ((e = t.alternate), e !== null && ((e = e.memoizedState), e !== null && ((e = e.dehydrated), e !== null)))
    )
      try {
        ta(e);
      } catch (n) {
        K(t, t.return, n);
      }
  }
  function e0(e) {
    switch (e.tag) {
      case 31:
      case 13:
      case 19:
        var t = e.stateNode;
        return (t === null && (t = e.stateNode = new Od()), t);
      case 22:
        return ((e = e.stateNode), (t = e._retryCache), t === null && (t = e._retryCache = new Od()), t);
      default:
        throw Error(p(435, e.tag));
    }
  }
  function Jl(e, t) {
    var n = e0(e);
    t.forEach(function (i) {
      if (!n.has(i)) {
        n.add(i);
        var a = o0.bind(null, e, i);
        i.then(a, a);
      }
    });
  }
  function De(e, t) {
    var n = t.deletions;
    if (n !== null)
      for (var i = 0; i < n.length; i++) {
        var a = n[i],
          l = e,
          r = t,
          s = r;
        e: for (; s !== null;) {
          switch (s.tag) {
            case 27:
              if (Tn(s.type)) {
                ((F = s.stateNode), (je = !1));
                break e;
              }
              break;
            case 5:
              ((F = s.stateNode), (je = !1));
              break e;
            case 3:
            case 4:
              ((F = s.stateNode.containerInfo), (je = !0));
              break e;
          }
          s = s.return;
        }
        if (F === null) throw Error(p(160));
        (Wg(l, r, a), (F = null), (je = !1), (l = a.alternate), l !== null && (l.return = null), (a.return = null));
      }
    if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) (ey(t, e), (t = t.sibling));
  }
  var gt = null;
  function ey(e, t) {
    var n = e.alternate,
      i = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        (De(t, e), ze(e), i & 4 && (En(3, e, e.return), pl(3, e), En(5, e, e.return)));
        break;
      case 1:
        (De(t, e),
          ze(e),
          i & 512 && (ce || n === null || bt(n, n.return)),
          i & 64 &&
            jt &&
            ((e = e.updateQueue),
            e !== null &&
              ((i = e.callbacks),
              i !== null &&
                ((n = e.shared.hiddenCallbacks), (e.shared.hiddenCallbacks = n === null ? i : n.concat(i))))));
        break;
      case 26:
        var a = gt;
        if ((De(t, e), ze(e), i & 512 && (ce || n === null || bt(n, n.return)), i & 4)) {
          var l = n !== null ? n.memoizedState : null;
          if (((i = e.memoizedState), n === null))
            if (i === null)
              if (e.stateNode === null) {
                e: {
                  ((i = e.type), (n = e.memoizedProps), (a = a.ownerDocument || a));
                  t: switch (i) {
                    case "title":
                      ((l = a.getElementsByTagName("title")[0]),
                        (!l ||
                          l[gl] ||
                          l[we] ||
                          l.namespaceURI === "http://www.w3.org/2000/svg" ||
                          l.hasAttribute("itemprop")) &&
                          ((l = a.createElement(i)), a.head.insertBefore(l, a.querySelector("head > title"))),
                        Ae(l, i, n),
                        (l[we] = e),
                        ve(l),
                        (i = l));
                      break e;
                    case "link":
                      var r = Zd("link", "href", a).get(i + (n.href || ""));
                      if (r) {
                        for (var s = 0; s < r.length; s++)
                          if (
                            ((l = r[s]),
                            l.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) &&
                              l.getAttribute("rel") === (n.rel == null ? null : n.rel) &&
                              l.getAttribute("title") === (n.title == null ? null : n.title) &&
                              l.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin))
                          ) {
                            r.splice(s, 1);
                            break t;
                          }
                      }
                      ((l = a.createElement(i)), Ae(l, i, n), a.head.appendChild(l));
                      break;
                    case "meta":
                      if ((r = Zd("meta", "content", a).get(i + (n.content || "")))) {
                        for (s = 0; s < r.length; s++)
                          if (
                            ((l = r[s]),
                            l.getAttribute("content") === (n.content == null ? null : "" + n.content) &&
                              l.getAttribute("name") === (n.name == null ? null : n.name) &&
                              l.getAttribute("property") === (n.property == null ? null : n.property) &&
                              l.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) &&
                              l.getAttribute("charset") === (n.charSet == null ? null : n.charSet))
                          ) {
                            r.splice(s, 1);
                            break t;
                          }
                      }
                      ((l = a.createElement(i)), Ae(l, i, n), a.head.appendChild(l));
                      break;
                    default:
                      throw Error(p(468, i));
                  }
                  ((l[we] = e), ve(l), (i = l));
                }
                e.stateNode = i;
              } else $d(a, e.type, e.stateNode);
            else e.stateNode = Jd(a, i, e.memoizedProps);
          else
            l !== i
              ? (l === null ? n.stateNode !== null && ((n = n.stateNode), n.parentNode.removeChild(n)) : l.count--,
                i === null ? $d(a, e.type, e.stateNode) : Jd(a, i, e.memoizedProps))
              : i === null && e.stateNode !== null && bu(e, e.memoizedProps, n.memoizedProps);
        }
        break;
      case 27:
        (De(t, e),
          ze(e),
          i & 512 && (ce || n === null || bt(n, n.return)),
          n !== null && i & 4 && bu(e, e.memoizedProps, n.memoizedProps));
        break;
      case 5:
        if ((De(t, e), ze(e), i & 512 && (ce || n === null || bt(n, n.return)), e.flags & 32)) {
          a = e.stateNode;
          try {
            Qi(a, "");
          } catch (_) {
            K(e, e.return, _);
          }
        }
        (i & 4 && e.stateNode != null && ((a = e.memoizedProps), bu(e, a, n !== null ? n.memoizedProps : a)),
          i & 1024 && (Su = !0));
        break;
      case 6:
        if ((De(t, e), ze(e), i & 4)) {
          if (e.stateNode === null) throw Error(p(162));
          ((i = e.memoizedProps), (n = e.stateNode));
          try {
            n.nodeValue = i;
          } catch (_) {
            K(e, e.return, _);
          }
        }
        break;
      case 3:
        if (
          ((dr = null),
          (a = gt),
          (gt = Hr(t.containerInfo)),
          De(t, e),
          (gt = a),
          ze(e),
          i & 4 && n !== null && n.memoizedState.isDehydrated)
        )
          try {
            ta(t.containerInfo);
          } catch (_) {
            K(e, e.return, _);
          }
        Su && ((Su = !1), ty(e));
        break;
      case 4:
        ((i = gt), (gt = Hr(e.stateNode.containerInfo)), De(t, e), ze(e), (gt = i));
        break;
      case 12:
        (De(t, e), ze(e));
        break;
      case 31:
        (De(t, e), ze(e), i & 4 && ((i = e.updateQueue), i !== null && ((e.updateQueue = null), Jl(e, i))));
        break;
      case 13:
        (De(t, e),
          ze(e),
          e.child.flags & 8192 && (e.memoizedState !== null) != (n !== null && n.memoizedState !== null) && (ts = Ie()),
          i & 4 && ((i = e.updateQueue), i !== null && ((e.updateQueue = null), Jl(e, i))));
        break;
      case 22:
        a = e.memoizedState !== null;
        var u = n !== null && n.memoizedState !== null,
          o = jt,
          f = ce;
        if (((jt = o || a), (ce = f || u), De(t, e), (ce = f), (jt = o), ze(e), i & 8192))
          e: for (
            t = e.stateNode,
              t._visibility = a ? t._visibility & -2 : t._visibility | 1,
              a && (n === null || u || jt || ce || Hn(e)),
              n = null,
              t = e;
            ;
          ) {
            if (t.tag === 5 || t.tag === 26) {
              if (n === null) {
                u = n = t;
                try {
                  if (((l = u.stateNode), a))
                    ((r = l.style),
                      typeof r.setProperty == "function"
                        ? r.setProperty("display", "none", "important")
                        : (r.display = "none"));
                  else {
                    s = u.stateNode;
                    var m = u.memoizedProps.style,
                      d = m != null && m.hasOwnProperty("display") ? m.display : null;
                    s.style.display = d == null || typeof d == "boolean" ? "" : ("" + d).trim();
                  }
                } catch (_) {
                  K(u, u.return, _);
                }
              }
            } else if (t.tag === 6) {
              if (n === null) {
                u = t;
                try {
                  u.stateNode.nodeValue = a ? "" : u.memoizedProps;
                } catch (_) {
                  K(u, u.return, _);
                }
              }
            } else if (t.tag === 18) {
              if (n === null) {
                u = t;
                try {
                  var g = u.stateNode;
                  a ? Yd(g, !0) : Yd(u.stateNode, !1);
                } catch (_) {
                  K(u, u.return, _);
                }
              }
            } else if (((t.tag !== 22 && t.tag !== 23) || t.memoizedState === null || t === e) && t.child !== null) {
              ((t.child.return = t), (t = t.child));
              continue;
            }
            if (t === e) break e;
            for (; t.sibling === null;) {
              if (t.return === null || t.return === e) break e;
              (n === t && (n = null), (t = t.return));
            }
            (n === t && (n = null), (t.sibling.return = t.return), (t = t.sibling));
          }
        i & 4 &&
          ((i = e.updateQueue), i !== null && ((n = i.retryQueue), n !== null && ((i.retryQueue = null), Jl(e, n))));
        break;
      case 19:
        (De(t, e), ze(e), i & 4 && ((i = e.updateQueue), i !== null && ((e.updateQueue = null), Jl(e, i))));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        (De(t, e), ze(e));
    }
  }
  function ze(e) {
    var t = e.flags;
    if (t & 2) {
      try {
        for (var n, i = e.return; i !== null;) {
          if (Qg(i)) {
            n = i;
            break;
          }
          i = i.return;
        }
        if (n == null) throw Error(p(160));
        switch (n.tag) {
          case 27:
            var a = n.stateNode,
              l = wu(e);
            Ur(e, l, a);
            break;
          case 5:
            var r = n.stateNode;
            n.flags & 32 && (Qi(r, ""), (n.flags &= -33));
            var s = wu(e);
            Ur(e, s, r);
            break;
          case 3:
          case 4:
            var u = n.stateNode.containerInfo,
              o = wu(e);
            oo(e, o, u);
            break;
          default:
            throw Error(p(161));
        }
      } catch (f) {
        K(e, e.return, f);
      }
      e.flags &= -3;
    }
    t & 4096 && (e.flags &= -4097);
  }
  function ty(e) {
    if (e.subtreeFlags & 1024)
      for (e = e.child; e !== null;) {
        var t = e;
        (ty(t), t.tag === 5 && t.flags & 1024 && t.stateNode.reset(), (e = e.sibling));
      }
  }
  function Nt(e, t) {
    if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) (Zg(e, t.alternate, t), (t = t.sibling));
  }
  function Hn(e) {
    for (e = e.child; e !== null;) {
      var t = e;
      switch (t.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          (En(4, t, t.return), Hn(t));
          break;
        case 1:
          bt(t, t.return);
          var n = t.stateNode;
          (typeof n.componentWillUnmount == "function" && Vg(t, t.return, n), Hn(t));
          break;
        case 27:
          Za(t.stateNode);
        case 26:
        case 5:
          (bt(t, t.return), Hn(t));
          break;
        case 22:
          t.memoizedState === null && Hn(t);
          break;
        case 30:
          Hn(t);
          break;
        default:
          Hn(t);
      }
      e = e.sibling;
    }
  }
  function Dt(e, t, n) {
    for (n = n && (t.subtreeFlags & 8772) !== 0, t = t.child; t !== null;) {
      var i = t.alternate,
        a = e,
        l = t,
        r = l.flags;
      switch (l.tag) {
        case 0:
        case 11:
        case 15:
          (Dt(a, l, n), pl(4, l));
          break;
        case 1:
          if ((Dt(a, l, n), (i = l), (a = i.stateNode), typeof a.componentDidMount == "function"))
            try {
              a.componentDidMount();
            } catch (o) {
              K(i, i.return, o);
            }
          if (((i = l), (a = i.updateQueue), a !== null)) {
            var s = i.stateNode;
            try {
              var u = a.shared.hiddenCallbacks;
              if (u !== null) for (a.shared.hiddenCallbacks = null, a = 0; a < u.length; a++) Fh(u[a], s);
            } catch (o) {
              K(i, i.return, o);
            }
          }
          (n && r & 64 && Ig(l), Va(l, l.return));
          break;
        case 27:
          Jg(l);
        case 26:
        case 5:
          (Dt(a, l, n), n && i === null && r & 4 && Xg(l), Va(l, l.return));
          break;
        case 12:
          Dt(a, l, n);
          break;
        case 31:
          (Dt(a, l, n), n && r & 4 && Fg(a, l));
          break;
        case 13:
          (Dt(a, l, n), n && r & 4 && Pg(a, l));
          break;
        case 22:
          (l.memoizedState === null && Dt(a, l, n), Va(l, l.return));
          break;
        case 30:
          break;
        default:
          Dt(a, l, n);
      }
      t = t.sibling;
    }
  }
  function oc(e, t) {
    var n = null;
    (e !== null &&
      e.memoizedState !== null &&
      e.memoizedState.cachePool !== null &&
      (n = e.memoizedState.cachePool.pool),
      (e = null),
      t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool),
      e !== n && (e != null && e.refCount++, n != null && ml(n)));
  }
  function cc(e, t) {
    ((e = null),
      t.alternate !== null && (e = t.alternate.memoizedState.cache),
      (t = t.memoizedState.cache),
      t !== e && (t.refCount++, e != null && ml(e)));
  }
  function ht(e, t, n, i) {
    if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) (ny(e, t, n, i), (t = t.sibling));
  }
  function ny(e, t, n, i) {
    var a = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        (ht(e, t, n, i), a & 2048 && pl(9, t));
        break;
      case 1:
        ht(e, t, n, i);
        break;
      case 3:
        (ht(e, t, n, i),
          a & 2048 &&
            ((e = null),
            t.alternate !== null && (e = t.alternate.memoizedState.cache),
            (t = t.memoizedState.cache),
            t !== e && (t.refCount++, e != null && ml(e))));
        break;
      case 12:
        if (a & 2048) {
          (ht(e, t, n, i), (e = t.stateNode));
          try {
            var l = t.memoizedProps,
              r = l.id,
              s = l.onPostCommit;
            typeof s == "function" && s(r, t.alternate === null ? "mount" : "update", e.passiveEffectDuration, -0);
          } catch (u) {
            K(t, t.return, u);
          }
        } else ht(e, t, n, i);
        break;
      case 31:
        ht(e, t, n, i);
        break;
      case 13:
        ht(e, t, n, i);
        break;
      case 23:
        break;
      case 22:
        ((l = t.stateNode),
          (r = t.alternate),
          t.memoizedState !== null
            ? l._visibility & 2
              ? ht(e, t, n, i)
              : Xa(e, t)
            : l._visibility & 2
              ? ht(e, t, n, i)
              : ((l._visibility |= 2), Ai(e, t, n, i, (t.subtreeFlags & 10256) !== 0 || !1)),
          a & 2048 && oc(r, t));
        break;
      case 24:
        (ht(e, t, n, i), a & 2048 && cc(t.alternate, t));
        break;
      default:
        ht(e, t, n, i);
    }
  }
  function Ai(e, t, n, i, a) {
    for (a = a && ((t.subtreeFlags & 10256) !== 0 || !1), t = t.child; t !== null;) {
      var l = e,
        r = t,
        s = n,
        u = i,
        o = r.flags;
      switch (r.tag) {
        case 0:
        case 11:
        case 15:
          (Ai(l, r, s, u, a), pl(8, r));
          break;
        case 23:
          break;
        case 22:
          var f = r.stateNode;
          (r.memoizedState !== null
            ? f._visibility & 2
              ? Ai(l, r, s, u, a)
              : Xa(l, r)
            : ((f._visibility |= 2), Ai(l, r, s, u, a)),
            a && o & 2048 && oc(r.alternate, r));
          break;
        case 24:
          (Ai(l, r, s, u, a), a && o & 2048 && cc(r.alternate, r));
          break;
        default:
          Ai(l, r, s, u, a);
      }
      t = t.sibling;
    }
  }
  function Xa(e, t) {
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null;) {
        var n = e,
          i = t,
          a = i.flags;
        switch (i.tag) {
          case 22:
            (Xa(n, i), a & 2048 && oc(i.alternate, i));
            break;
          case 24:
            (Xa(n, i), a & 2048 && cc(i.alternate, i));
            break;
          default:
            Xa(n, i);
        }
        t = t.sibling;
      }
  }
  var Ma = 8192;
  function Ei(e, t, n) {
    if (e.subtreeFlags & Ma) for (e = e.child; e !== null;) (iy(e, t, n), (e = e.sibling));
  }
  function iy(e, t, n) {
    switch (e.tag) {
      case 26:
        (Ei(e, t, n), e.flags & Ma && e.memoizedState !== null && L0(n, gt, e.memoizedState, e.memoizedProps));
        break;
      case 5:
        Ei(e, t, n);
        break;
      case 3:
      case 4:
        var i = gt;
        ((gt = Hr(e.stateNode.containerInfo)), Ei(e, t, n), (gt = i));
        break;
      case 22:
        e.memoizedState === null &&
          ((i = e.alternate),
          i !== null && i.memoizedState !== null ? ((i = Ma), (Ma = 16777216), Ei(e, t, n), (Ma = i)) : Ei(e, t, n));
        break;
      default:
        Ei(e, t, n);
    }
  }
  function ay(e) {
    var t = e.alternate;
    if (t !== null && ((e = t.child), e !== null)) {
      t.child = null;
      do ((t = e.sibling), (e.sibling = null), (e = t));
      while (e !== null);
    }
  }
  function ka(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var n = 0; n < t.length; n++) {
          var i = t[n];
          ((me = i), ry(i, e));
        }
      ay(e);
    }
    if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) (ly(e), (e = e.sibling));
  }
  function ly(e) {
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        (ka(e), e.flags & 2048 && En(9, e, e.return));
        break;
      case 3:
        ka(e);
        break;
      case 12:
        ka(e);
        break;
      case 22:
        var t = e.stateNode;
        e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13)
          ? ((t._visibility &= -3), cr(e))
          : ka(e);
        break;
      default:
        ka(e);
    }
  }
  function cr(e) {
    var t = e.deletions;
    if ((e.flags & 16) !== 0) {
      if (t !== null)
        for (var n = 0; n < t.length; n++) {
          var i = t[n];
          ((me = i), ry(i, e));
        }
      ay(e);
    }
    for (e = e.child; e !== null;) {
      switch (((t = e), t.tag)) {
        case 0:
        case 11:
        case 15:
          (En(8, t, t.return), cr(t));
          break;
        case 22:
          ((n = t.stateNode), n._visibility & 2 && ((n._visibility &= -3), cr(t)));
          break;
        default:
          cr(t);
      }
      e = e.sibling;
    }
  }
  function ry(e, t) {
    for (; me !== null;) {
      var n = me;
      switch (n.tag) {
        case 0:
        case 11:
        case 15:
          En(8, n, t);
          break;
        case 23:
        case 22:
          if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
            var i = n.memoizedState.cachePool.pool;
            i != null && i.refCount++;
          }
          break;
        case 24:
          ml(n.memoizedState.cache);
      }
      if (((i = n.child), i !== null)) ((i.return = n), (me = i));
      else
        e: for (n = e; me !== null;) {
          i = me;
          var a = i.sibling,
            l = i.return;
          if (($g(i), i === n)) {
            me = null;
            break e;
          }
          if (a !== null) {
            ((a.return = l), (me = a));
            break e;
          }
          me = l;
        }
    }
  }
  var t0 = {
      getCacheForType: function (e) {
        var t = Ee(fe),
          n = t.data.get(e);
        return (n === void 0 && ((n = e()), t.data.set(e, n)), n);
      },
      cacheSignal: function () {
        return Ee(fe).controller.signal;
      },
    },
    n0 = typeof WeakMap == "function" ? WeakMap : Map,
    H = 0,
    V = null,
    j = null,
    M = 0,
    G = 0,
    Be = null,
    on = !1,
    ra = !1,
    fc = !1,
    Xt = 0,
    ae = 0,
    An = 0,
    In = 0,
    dc = 0,
    Ye = 0,
    Wi = 0,
    Qa = null,
    Me = null,
    co = !1,
    ts = 0,
    sy = 0,
    Nr = 1 / 0,
    Dr = null,
    mn = null,
    ge = 0,
    vn = null,
    Fi = null,
    Gt = 0,
    fo = 0,
    ho = null,
    uy = null,
    Ja = 0,
    go = null;
  function Qe() {
    return (H & 2) !== 0 && M !== 0 ? M & -M : U.T !== null ? gc() : vh();
  }
  function oy() {
    if (Ye === 0)
      if ((M & 536870912) === 0 || L) {
        var e = Ll;
        ((Ll <<= 1), (Ll & 3932160) === 0 && (Ll = 262144), (Ye = e));
      } else Ye = 536870912;
    return ((e = Ze.current), e !== null && (e.flags |= 32), Ye);
  }
  function qe(e, t, n) {
    (((e === V && (G === 2 || G === 9)) || e.cancelPendingCommit !== null) && (Pi(e, 0), cn(e, M, Ye, !1)),
      hl(e, n),
      ((H & 2) === 0 || e !== V) && (e === V && ((H & 2) === 0 && (In |= n), ae === 4 && cn(e, M, Ye, !1)), Et(e)));
  }
  function cy(e, t, n) {
    if ((H & 6) !== 0) throw Error(p(327));
    var i = (!n && (t & 127) === 0 && (t & e.expiredLanes) === 0) || dl(e, t),
      a = i ? l0(e, t) : Eu(e, t, !0),
      l = i;
    do {
      if (a === 0) {
        ra && !i && cn(e, t, 0, !1);
        break;
      } else {
        if (((n = e.current.alternate), l && !i0(n))) {
          ((a = Eu(e, t, !1)), (l = !1));
          continue;
        }
        if (a === 2) {
          if (((l = t), e.errorRecoveryDisabledLanes & l)) var r = 0;
          else ((r = e.pendingLanes & -536870913), (r = r !== 0 ? r : r & 536870912 ? 536870912 : 0));
          if (r !== 0) {
            t = r;
            e: {
              var s = e;
              a = Qa;
              var u = s.current.memoizedState.isDehydrated;
              if ((u && (Pi(s, r).flags |= 256), (r = Eu(s, r, !1)), r !== 2)) {
                if (fc && !u) {
                  ((s.errorRecoveryDisabledLanes |= l), (In |= l), (a = 4));
                  break e;
                }
                ((l = Me), (Me = a), l !== null && (Me === null ? (Me = l) : Me.push.apply(Me, l)));
              }
              a = r;
            }
            if (((l = !1), a !== 2)) continue;
          }
        }
        if (a === 1) {
          (Pi(e, 0), cn(e, t, 0, !0));
          break;
        }
        e: {
          switch (((i = e), (l = a), l)) {
            case 0:
            case 1:
              throw Error(p(345));
            case 4:
              if ((t & 4194048) !== t) break;
            case 6:
              cn(i, t, Ye, !on);
              break e;
            case 2:
              Me = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(p(329));
          }
          if ((t & 62914560) === t && ((a = ts + 300 - Ie()), 10 < a)) {
            if ((cn(i, t, Ye, !on), Ir(i, 0, !0) !== 0)) break e;
            ((Gt = t),
              (i.timeoutHandle = Cy(xd.bind(null, i, n, Me, Dr, co, t, Ye, In, Wi, on, l, "Throttled", -0, 0), a)));
            break e;
          }
          xd(i, n, Me, Dr, co, t, Ye, In, Wi, on, l, null, -0, 0);
        }
      }
      break;
    } while (!0);
    Et(e);
  }
  function xd(e, t, n, i, a, l, r, s, u, o, f, m, d, g) {
    if (((e.timeoutHandle = -1), (m = t.subtreeFlags), m & 8192 || (m & 16785408) === 16785408)) {
      ((m = {
        stylesheets: null,
        count: 0,
        imgCount: 0,
        imgBytes: 0,
        suspenseyImages: [],
        waitingForImages: !0,
        waitingForViewTransition: !1,
        unsuspend: qt,
      }),
        iy(t, l, m));
      var _ = (l & 62914560) === l ? ts - Ie() : (l & 4194048) === l ? sy - Ie() : 0;
      if (((_ = H0(m, _)), _ !== null)) {
        ((Gt = l),
          (e.cancelPendingCommit = _(Cd.bind(null, e, t, l, n, i, a, r, s, u, f, m, null, d, g))),
          cn(e, l, r, !o));
        return;
      }
    }
    Cd(e, t, l, n, i, a, r, s, u);
  }
  function i0(e) {
    for (var t = e; ;) {
      var n = t.tag;
      if (
        (n === 0 || n === 11 || n === 15) &&
        t.flags & 16384 &&
        ((n = t.updateQueue), n !== null && ((n = n.stores), n !== null))
      )
        for (var i = 0; i < n.length; i++) {
          var a = n[i],
            l = a.getSnapshot;
          a = a.value;
          try {
            if (!Je(l(), a)) return !1;
          } catch {
            return !1;
          }
        }
      if (((n = t.child), t.subtreeFlags & 16384 && n !== null)) ((n.return = t), (t = n));
      else {
        if (t === e) break;
        for (; t.sibling === null;) {
          if (t.return === null || t.return === e) return !0;
          t = t.return;
        }
        ((t.sibling.return = t.return), (t = t.sibling));
      }
    }
    return !0;
  }
  function cn(e, t, n, i) {
    ((t &= ~dc),
      (t &= ~In),
      (e.suspendedLanes |= t),
      (e.pingedLanes &= ~t),
      i && (e.warmLanes |= t),
      (i = e.expirationTimes));
    for (var a = t; 0 < a;) {
      var l = 31 - Xe(a),
        r = 1 << l;
      ((i[l] = -1), (a &= ~r));
    }
    n !== 0 && gh(e, n, t);
  }
  function ns() {
    return (H & 6) === 0 ? (_l(0, !1), !1) : !0;
  }
  function hc() {
    if (j !== null) {
      if (G === 0) var e = j.return;
      else ((e = j), (Lt = ei = null), Fo(e), (Ki = null), (nl = 0), (e = j));
      for (; e !== null;) (Yg(e.alternate, e), (e = e.return));
      j = null;
    }
  }
  function Pi(e, t) {
    var n = e.timeoutHandle;
    (n !== -1 && ((e.timeoutHandle = -1), w0(n)),
      (n = e.cancelPendingCommit),
      n !== null && ((e.cancelPendingCommit = null), n()),
      (Gt = 0),
      hc(),
      (V = e),
      (j = n = Ht(e.current, null)),
      (M = t),
      (G = 0),
      (Be = null),
      (on = !1),
      (ra = dl(e, t)),
      (fc = !1),
      (Wi = Ye = dc = In = An = ae = 0),
      (Me = Qa = null),
      (co = !1),
      (t & 8) !== 0 && (t |= t & 32));
    var i = e.entangledLanes;
    if (i !== 0)
      for (e = e.entanglements, i &= t; 0 < i;) {
        var a = 31 - Xe(i),
          l = 1 << a;
        ((t |= e[a]), (i &= ~l));
      }
    return ((Xt = t), Jr(), n);
  }
  function fy(e, t) {
    ((D = null),
      (U.H = al),
      t === la || t === $r
        ? ((t = rd()), (G = 3))
        : t === Vo
          ? ((t = rd()), (G = 4))
          : (G = t === sc ? 8 : t !== null && typeof t == "object" && typeof t.then == "function" ? 6 : 1),
      (Be = t),
      j === null && ((ae = 1), kr(e, at(t, e.current))));
  }
  function dy() {
    var e = Ze.current;
    return e === null
      ? !0
      : (M & 4194048) === M
        ? rt === null
        : (M & 62914560) === M || (M & 536870912) !== 0
          ? e === rt
          : !1;
  }
  function hy() {
    var e = U.H;
    return ((U.H = al), e === null ? al : e);
  }
  function gy() {
    var e = U.A;
    return ((U.A = t0), e);
  }
  function zr() {
    ((ae = 4),
      on || ((M & 4194048) !== M && Ze.current !== null) || (ra = !0),
      ((An & 134217727) === 0 && (In & 134217727) === 0) || V === null || cn(V, M, Ye, !1));
  }
  function Eu(e, t, n) {
    var i = H;
    H |= 2;
    var a = hy(),
      l = gy();
    ((V !== e || M !== t) && ((Dr = null), Pi(e, t)), (t = !1));
    var r = ae;
    e: do
      try {
        if (G !== 0 && j !== null) {
          var s = j,
            u = Be;
          switch (G) {
            case 8:
              (hc(), (r = 6));
              break e;
            case 3:
            case 2:
            case 9:
            case 6:
              Ze.current === null && (t = !0);
              var o = G;
              if (((G = 0), (Be = null), qi(e, s, u, o), n && ra)) {
                r = 0;
                break e;
              }
              break;
            default:
              ((o = G), (G = 0), (Be = null), qi(e, s, u, o));
          }
        }
        (a0(), (r = ae));
        break;
      } catch (f) {
        fy(e, f);
      }
    while (!0);
    return (
      t && e.shellSuspendCounter++,
      (Lt = ei = null),
      (H = i),
      (U.H = a),
      (U.A = l),
      j === null && ((V = null), (M = 0), Jr()),
      r
    );
  }
  function a0() {
    for (; j !== null;) yy(j);
  }
  function l0(e, t) {
    var n = H;
    H |= 2;
    var i = hy(),
      a = gy();
    V !== e || M !== t ? ((Dr = null), (Nr = Ie() + 500), Pi(e, t)) : (ra = dl(e, t));
    e: do
      try {
        if (G !== 0 && j !== null) {
          t = j;
          var l = Be;
          t: switch (G) {
            case 1:
              ((G = 0), (Be = null), qi(e, t, l, 1));
              break;
            case 2:
            case 9:
              if (ld(l)) {
                ((G = 0), (Be = null), kd(t));
                break;
              }
              ((t = function () {
                ((G !== 2 && G !== 9) || V !== e || (G = 7), Et(e));
              }),
                l.then(t, t));
              break e;
            case 3:
              G = 7;
              break e;
            case 4:
              G = 5;
              break e;
            case 7:
              ld(l) ? ((G = 0), (Be = null), kd(t)) : ((G = 0), (Be = null), qi(e, t, l, 7));
              break;
            case 5:
              var r = null;
              switch (j.tag) {
                case 26:
                  r = j.memoizedState;
                case 5:
                case 27:
                  var s = j;
                  if (r ? jy(r) : s.stateNode.complete) {
                    ((G = 0), (Be = null));
                    var u = s.sibling;
                    if (u !== null) j = u;
                    else {
                      var o = s.return;
                      o !== null ? ((j = o), is(o)) : (j = null);
                    }
                    break t;
                  }
              }
              ((G = 0), (Be = null), qi(e, t, l, 5));
              break;
            case 6:
              ((G = 0), (Be = null), qi(e, t, l, 6));
              break;
            case 8:
              (hc(), (ae = 6));
              break e;
            default:
              throw Error(p(462));
          }
        }
        r0();
        break;
      } catch (f) {
        fy(e, f);
      }
    while (!0);
    return ((Lt = ei = null), (U.H = i), (U.A = a), (H = n), j !== null ? 0 : ((V = null), (M = 0), Jr(), ae));
  }
  function r0() {
    for (; j !== null && !kv();) yy(j);
  }
  function yy(e) {
    var t = Kg(e.alternate, e, Xt);
    ((e.memoizedProps = e.pendingProps), t === null ? is(e) : (j = t));
  }
  function kd(e) {
    var t = e,
      n = t.alternate;
    switch (t.tag) {
      case 15:
      case 0:
        t = Sd(n, t, t.pendingProps, t.type, void 0, M);
        break;
      case 11:
        t = Sd(n, t, t.pendingProps, t.type.render, t.ref, M);
        break;
      case 5:
        Fo(t);
      default:
        (Yg(n, t), (t = j = Yh(t, Xt)), (t = Kg(n, t, Xt)));
    }
    ((e.memoizedProps = e.pendingProps), t === null ? is(e) : (j = t));
  }
  function qi(e, t, n, i) {
    ((Lt = ei = null), Fo(t), (Ki = null), (nl = 0));
    var a = t.return;
    try {
      if (Jp(e, a, t, n, M)) {
        ((ae = 1), kr(e, at(n, e.current)), (j = null));
        return;
      }
    } catch (l) {
      if (a !== null) throw ((j = a), l);
      ((ae = 1), kr(e, at(n, e.current)), (j = null));
      return;
    }
    t.flags & 32768
      ? (L || i === 1
          ? (e = !0)
          : ra || (M & 536870912) !== 0
            ? (e = !1)
            : ((on = e = !0),
              (i === 2 || i === 9 || i === 3 || i === 6) &&
                ((i = Ze.current), i !== null && i.tag === 13 && (i.flags |= 16384))),
        my(t, e))
      : is(t);
  }
  function is(e) {
    var t = e;
    do {
      if ((t.flags & 32768) !== 0) {
        my(t, on);
        return;
      }
      e = t.return;
      var n = Wp(t.alternate, t, Xt);
      if (n !== null) {
        j = n;
        return;
      }
      if (((t = t.sibling), t !== null)) {
        j = t;
        return;
      }
      j = t = e;
    } while (t !== null);
    ae === 0 && (ae = 5);
  }
  function my(e, t) {
    do {
      var n = Fp(e.alternate, e);
      if (n !== null) {
        ((n.flags &= 32767), (j = n));
        return;
      }
      if (
        ((n = e.return),
        n !== null && ((n.flags |= 32768), (n.subtreeFlags = 0), (n.deletions = null)),
        !t && ((e = e.sibling), e !== null))
      ) {
        j = e;
        return;
      }
      j = e = n;
    } while (e !== null);
    ((ae = 6), (j = null));
  }
  function Cd(e, t, n, i, a, l, r, s, u) {
    e.cancelPendingCommit = null;
    do as();
    while (ge !== 0);
    if ((H & 6) !== 0) throw Error(p(327));
    if (t !== null) {
      if (t === e.current) throw Error(p(177));
      if (
        ((l = t.lanes | t.childLanes),
        (l |= Lo),
        Hv(e, n, l, r, s, u),
        e === V && ((j = V = null), (M = 0)),
        (Fi = t),
        (vn = e),
        (Gt = n),
        (fo = l),
        (ho = a),
        (uy = i),
        (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0
          ? ((e.callbackNode = null),
            (e.callbackPriority = 0),
            c0(pr, function () {
              return (wy(), null);
            }))
          : ((e.callbackNode = null), (e.callbackPriority = 0)),
        (i = (t.flags & 13878) !== 0),
        (t.subtreeFlags & 13878) !== 0 || i)
      ) {
        ((i = U.T), (U.T = null), (a = B.p), (B.p = 2), (r = H), (H |= 4));
        try {
          Pp(e, t, n);
        } finally {
          ((H = r), (B.p = a), (U.T = i));
        }
      }
      ((ge = 1), vy(), py(), _y());
    }
  }
  function vy() {
    if (ge === 1) {
      ge = 0;
      var e = vn,
        t = Fi,
        n = (t.flags & 13878) !== 0;
      if ((t.subtreeFlags & 13878) !== 0 || n) {
        ((n = U.T), (U.T = null));
        var i = B.p;
        B.p = 2;
        var a = H;
        H |= 4;
        try {
          ey(t, e);
          var l = po,
            r = jh(e.containerInfo),
            s = l.focusedElem,
            u = l.selectionRange;
          if (r !== s && s && s.ownerDocument && zh(s.ownerDocument.documentElement, s)) {
            if (u !== null && qo(s)) {
              var o = u.start,
                f = u.end;
              if ((f === void 0 && (f = o), "selectionStart" in s))
                ((s.selectionStart = o), (s.selectionEnd = Math.min(f, s.value.length)));
              else {
                var m = s.ownerDocument || document,
                  d = (m && m.defaultView) || window;
                if (d.getSelection) {
                  var g = d.getSelection(),
                    _ = s.textContent.length,
                    b = Math.min(u.start, _),
                    A = u.end === void 0 ? b : Math.min(u.end, _);
                  !g.extend && b > A && ((r = A), (A = b), (b = r));
                  var y = Ff(s, b),
                    c = Ff(s, A);
                  if (
                    y &&
                    c &&
                    (g.rangeCount !== 1 ||
                      g.anchorNode !== y.node ||
                      g.anchorOffset !== y.offset ||
                      g.focusNode !== c.node ||
                      g.focusOffset !== c.offset)
                  ) {
                    var h = m.createRange();
                    (h.setStart(y.node, y.offset),
                      g.removeAllRanges(),
                      b > A
                        ? (g.addRange(h), g.extend(c.node, c.offset))
                        : (h.setEnd(c.node, c.offset), g.addRange(h)));
                  }
                }
              }
            }
            for (m = [], g = s; (g = g.parentNode);)
              g.nodeType === 1 && m.push({ element: g, left: g.scrollLeft, top: g.scrollTop });
            for (typeof s.focus == "function" && s.focus(), s = 0; s < m.length; s++) {
              var v = m[s];
              ((v.element.scrollLeft = v.left), (v.element.scrollTop = v.top));
            }
          }
          ((Kr = !!vo), (po = vo = null));
        } finally {
          ((H = a), (B.p = i), (U.T = n));
        }
      }
      ((e.current = t), (ge = 2));
    }
  }
  function py() {
    if (ge === 2) {
      ge = 0;
      var e = vn,
        t = Fi,
        n = (t.flags & 8772) !== 0;
      if ((t.subtreeFlags & 8772) !== 0 || n) {
        ((n = U.T), (U.T = null));
        var i = B.p;
        B.p = 2;
        var a = H;
        H |= 4;
        try {
          Zg(e, t.alternate, t);
        } finally {
          ((H = a), (B.p = i), (U.T = n));
        }
      }
      ge = 3;
    }
  }
  function _y() {
    if (ge === 4 || ge === 3) {
      ((ge = 0), Cv());
      var e = vn,
        t = Fi,
        n = Gt,
        i = uy;
      (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0
        ? (ge = 5)
        : ((ge = 0), (Fi = vn = null), by(e, e.pendingLanes));
      var a = e.pendingLanes;
      if ((a === 0 && (mn = null), Co(n), (t = t.stateNode), Ve && typeof Ve.onCommitFiberRoot == "function"))
        try {
          Ve.onCommitFiberRoot(fl, t, void 0, (t.current.flags & 128) === 128);
        } catch {}
      if (i !== null) {
        ((t = U.T), (a = B.p), (B.p = 2), (U.T = null));
        try {
          for (var l = e.onRecoverableError, r = 0; r < i.length; r++) {
            var s = i[r];
            l(s.value, { componentStack: s.stack });
          }
        } finally {
          ((U.T = t), (B.p = a));
        }
      }
      ((Gt & 3) !== 0 && as(),
        Et(e),
        (a = e.pendingLanes),
        (n & 261930) !== 0 && (a & 42) !== 0 ? (e === go ? Ja++ : ((Ja = 0), (go = e))) : (Ja = 0),
        _l(0, !1));
    }
  }
  function by(e, t) {
    (e.pooledCacheLanes &= t) === 0 && ((t = e.pooledCache), t != null && ((e.pooledCache = null), ml(t)));
  }
  function as() {
    return (vy(), py(), _y(), wy());
  }
  function wy() {
    if (ge !== 5) return !1;
    var e = vn,
      t = fo;
    fo = 0;
    var n = Co(Gt),
      i = U.T,
      a = B.p;
    try {
      ((B.p = 32 > n ? 32 : n), (U.T = null), (n = ho), (ho = null));
      var l = vn,
        r = Gt;
      if (((ge = 0), (Fi = vn = null), (Gt = 0), (H & 6) !== 0)) throw Error(p(331));
      var s = H;
      if (
        ((H |= 4),
        ly(l.current),
        ny(l, l.current, r, n),
        (H = s),
        _l(0, !1),
        Ve && typeof Ve.onPostCommitFiberRoot == "function")
      )
        try {
          Ve.onPostCommitFiberRoot(fl, l);
        } catch {}
      return !0;
    } finally {
      ((B.p = a), (U.T = i), by(e, t));
    }
  }
  function Ud(e, t, n) {
    ((t = at(n, t)), (t = ro(e.stateNode, t, 2)), (e = yn(e, t, 2)), e !== null && (hl(e, 2), Et(e)));
  }
  function K(e, t, n) {
    if (e.tag === 3) Ud(e, e, n);
    else
      for (; t !== null;) {
        if (t.tag === 3) {
          Ud(t, e, n);
          break;
        } else if (t.tag === 1) {
          var i = t.stateNode;
          if (
            typeof t.type.getDerivedStateFromError == "function" ||
            (typeof i.componentDidCatch == "function" && (mn === null || !mn.has(i)))
          ) {
            ((e = at(n, e)), (n = Mg(2)), (i = yn(t, n, 2)), i !== null && (qg(n, i, t, e), hl(i, 2), Et(i)));
            break;
          }
        }
        t = t.return;
      }
  }
  function Au(e, t, n) {
    var i = e.pingCache;
    if (i === null) {
      i = e.pingCache = new n0();
      var a = new Set();
      i.set(t, a);
    } else ((a = i.get(t)), a === void 0 && ((a = new Set()), i.set(t, a)));
    a.has(n) || ((fc = !0), a.add(n), (e = s0.bind(null, e, t, n)), t.then(e, e));
  }
  function s0(e, t, n) {
    var i = e.pingCache;
    (i !== null && i.delete(t),
      (e.pingedLanes |= e.suspendedLanes & n),
      (e.warmLanes &= ~n),
      V === e &&
        (M & n) === n &&
        (ae === 4 || (ae === 3 && (M & 62914560) === M && 300 > Ie() - ts) ? (H & 2) === 0 && Pi(e, 0) : (dc |= n),
        Wi === M && (Wi = 0)),
      Et(e));
  }
  function Sy(e, t) {
    (t === 0 && (t = hh()), (e = Pn(e, t)), e !== null && (hl(e, t), Et(e)));
  }
  function u0(e) {
    var t = e.memoizedState,
      n = 0;
    (t !== null && (n = t.retryLane), Sy(e, n));
  }
  function o0(e, t) {
    var n = 0;
    switch (e.tag) {
      case 31:
      case 13:
        var i = e.stateNode,
          a = e.memoizedState;
        a !== null && (n = a.retryLane);
        break;
      case 19:
        i = e.stateNode;
        break;
      case 22:
        i = e.stateNode._retryCache;
        break;
      default:
        throw Error(p(314));
    }
    (i !== null && i.delete(t), Sy(e, n));
  }
  function c0(e, t) {
    return xo(e, t);
  }
  var jr = null,
    Ri = null,
    yo = !1,
    Mr = !1,
    Ru = !1,
    fn = 0;
  function Et(e) {
    (e !== Ri && e.next === null && (Ri === null ? (jr = Ri = e) : (Ri = Ri.next = e)),
      (Mr = !0),
      yo || ((yo = !0), d0()));
  }
  function _l(e, t) {
    if (!Ru && Mr) {
      Ru = !0;
      do
        for (var n = !1, i = jr; i !== null;) {
          if (!t)
            if (e !== 0) {
              var a = i.pendingLanes;
              if (a === 0) var l = 0;
              else {
                var r = i.suspendedLanes,
                  s = i.pingedLanes;
                ((l = (1 << (31 - Xe(42 | e) + 1)) - 1),
                  (l &= a & ~(r & ~s)),
                  (l = l & 201326741 ? (l & 201326741) | 1 : l ? l | 2 : 0));
              }
              l !== 0 && ((n = !0), Nd(i, l));
            } else
              ((l = M),
                (l = Ir(i, i === V ? l : 0, i.cancelPendingCommit !== null || i.timeoutHandle !== -1)),
                (l & 3) === 0 || dl(i, l) || ((n = !0), Nd(i, l)));
          i = i.next;
        }
      while (n);
      Ru = !1;
    }
  }
  function f0() {
    Ey();
  }
  function Ey() {
    Mr = yo = !1;
    var e = 0;
    fn !== 0 && b0() && (e = fn);
    for (var t = Ie(), n = null, i = jr; i !== null;) {
      var a = i.next,
        l = Ay(i, t);
      (l === 0
        ? ((i.next = null), n === null ? (jr = a) : (n.next = a), a === null && (Ri = n))
        : ((n = i), (e !== 0 || (l & 3) !== 0) && (Mr = !0)),
        (i = a));
    }
    ((ge !== 0 && ge !== 5) || _l(e, !1), fn !== 0 && (fn = 0));
  }
  function Ay(e, t) {
    for (var n = e.suspendedLanes, i = e.pingedLanes, a = e.expirationTimes, l = e.pendingLanes & -62914561; 0 < l;) {
      var r = 31 - Xe(l),
        s = 1 << r,
        u = a[r];
      (u === -1 ? ((s & n) === 0 || (s & i) !== 0) && (a[r] = Lv(s, t)) : u <= t && (e.expiredLanes |= s), (l &= ~s));
    }
    if (
      ((t = V),
      (n = M),
      (n = Ir(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1)),
      (i = e.callbackNode),
      n === 0 || (e === t && (G === 2 || G === 9)) || e.cancelPendingCommit !== null)
    )
      return (i !== null && i !== null && eu(i), (e.callbackNode = null), (e.callbackPriority = 0));
    if ((n & 3) === 0 || dl(e, n)) {
      if (((t = n & -n), t === e.callbackPriority)) return t;
      switch ((i !== null && eu(i), Co(n))) {
        case 2:
        case 8:
          n = fh;
          break;
        case 32:
          n = pr;
          break;
        case 268435456:
          n = dh;
          break;
        default:
          n = pr;
      }
      return ((i = Ry.bind(null, e)), (n = xo(n, i)), (e.callbackPriority = t), (e.callbackNode = n), t);
    }
    return (i !== null && i !== null && eu(i), (e.callbackPriority = 2), (e.callbackNode = null), 2);
  }
  function Ry(e, t) {
    if (ge !== 0 && ge !== 5) return ((e.callbackNode = null), (e.callbackPriority = 0), null);
    var n = e.callbackNode;
    if (as() && e.callbackNode !== n) return null;
    var i = M;
    return (
      (i = Ir(e, e === V ? i : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1)),
      i === 0
        ? null
        : (cy(e, i, t), Ay(e, Ie()), e.callbackNode != null && e.callbackNode === n ? Ry.bind(null, e) : null)
    );
  }
  function Nd(e, t) {
    if (as()) return null;
    cy(e, t, !0);
  }
  function d0() {
    S0(function () {
      (H & 6) !== 0 ? xo(ch, f0) : Ey();
    });
  }
  function gc() {
    if (fn === 0) {
      var e = Ji;
      (e === 0 && ((e = ql), (ql <<= 1), (ql & 261888) === 0 && (ql = 256)), (fn = e));
    }
    return fn;
  }
  function Dd(e) {
    return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : tr("" + e);
  }
  function zd(e, t) {
    var n = t.ownerDocument.createElement("input");
    return (
      (n.name = t.name),
      (n.value = t.value),
      e.id && n.setAttribute("form", e.id),
      t.parentNode.insertBefore(n, t),
      (e = new FormData(e)),
      n.parentNode.removeChild(n),
      e
    );
  }
  function h0(e, t, n, i, a) {
    if (t === "submit" && n && n.stateNode === a) {
      var l = Dd((a[Le] || null).action),
        r = i.submitter;
      r &&
        ((t = (t = r[Le] || null) ? Dd(t.formAction) : r.getAttribute("formAction")),
        t !== null && ((l = t), (r = null)));
      var s = new Vr("action", "action", null, i, a);
      e.push({
        event: s,
        listeners: [
          {
            instance: null,
            listener: function () {
              if (i.defaultPrevented) {
                if (fn !== 0) {
                  var u = r ? zd(a, r) : new FormData(a);
                  ao(n, { pending: !0, data: u, method: a.method, action: l }, null, u);
                }
              } else
                typeof l == "function" &&
                  (s.preventDefault(),
                  (u = r ? zd(a, r) : new FormData(a)),
                  ao(n, { pending: !0, data: u, method: a.method, action: l }, l, u));
            },
            currentTarget: a,
          },
        ],
      });
    }
  }
  for (Zl = 0; Zl < Xu.length; Zl++)
    (($l = Xu[Zl]), (jd = $l.toLowerCase()), (Md = $l[0].toUpperCase() + $l.slice(1)), yt(jd, "on" + Md));
  var $l, jd, Md, Zl;
  yt(qh, "onAnimationEnd");
  yt(Lh, "onAnimationIteration");
  yt(Hh, "onAnimationStart");
  yt("dblclick", "onDoubleClick");
  yt("focusin", "onFocus");
  yt("focusout", "onBlur");
  yt(Up, "onTransitionRun");
  yt(Np, "onTransitionStart");
  yt(Dp, "onTransitionCancel");
  yt(Bh, "onTransitionEnd");
  Xi("onMouseEnter", ["mouseout", "mouseover"]);
  Xi("onMouseLeave", ["mouseout", "mouseover"]);
  Xi("onPointerEnter", ["pointerout", "pointerover"]);
  Xi("onPointerLeave", ["pointerout", "pointerover"]);
  $n("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
  $n("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
  $n("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
  $n("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
  $n("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
  $n("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
  var ll =
      "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
        " ",
      ),
    g0 = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(ll));
  function Ty(e, t) {
    t = (t & 4) !== 0;
    for (var n = 0; n < e.length; n++) {
      var i = e[n],
        a = i.event;
      i = i.listeners;
      e: {
        var l = void 0;
        if (t)
          for (var r = i.length - 1; 0 <= r; r--) {
            var s = i[r],
              u = s.instance,
              o = s.currentTarget;
            if (((s = s.listener), u !== l && a.isPropagationStopped())) break e;
            ((l = s), (a.currentTarget = o));
            try {
              l(a);
            } catch (f) {
              br(f);
            }
            ((a.currentTarget = null), (l = u));
          }
        else
          for (r = 0; r < i.length; r++) {
            if (
              ((s = i[r]),
              (u = s.instance),
              (o = s.currentTarget),
              (s = s.listener),
              u !== l && a.isPropagationStopped())
            )
              break e;
            ((l = s), (a.currentTarget = o));
            try {
              l(a);
            } catch (f) {
              br(f);
            }
            ((a.currentTarget = null), (l = u));
          }
      }
    }
  }
  function z(e, t) {
    var n = t[Lu];
    n === void 0 && (n = t[Lu] = new Set());
    var i = e + "__bubble";
    n.has(i) || (Oy(t, e, 2, !1), n.add(i));
  }
  function Tu(e, t, n) {
    var i = 0;
    (t && (i |= 4), Oy(n, e, i, t));
  }
  var Wl = "_reactListening" + Math.random().toString(36).slice(2);
  function yc(e) {
    if (!e[Wl]) {
      ((e[Wl] = !0),
        ph.forEach(function (n) {
          n !== "selectionchange" && (g0.has(n) || Tu(n, !1, e), Tu(n, !0, e));
        }));
      var t = e.nodeType === 9 ? e : e.ownerDocument;
      t === null || t[Wl] || ((t[Wl] = !0), Tu("selectionchange", !1, t));
    }
  }
  function Oy(e, t, n, i) {
    switch (By(t)) {
      case 2:
        var a = K0;
        break;
      case 8:
        a = Y0;
        break;
      default:
        a = _c;
    }
    ((n = a.bind(null, t, n, e)),
      (a = void 0),
      !Yu || (t !== "touchstart" && t !== "touchmove" && t !== "wheel") || (a = !0),
      i
        ? a !== void 0
          ? e.addEventListener(t, n, { capture: !0, passive: a })
          : e.addEventListener(t, n, !0)
        : a !== void 0
          ? e.addEventListener(t, n, { passive: a })
          : e.addEventListener(t, n, !1));
  }
  function Ou(e, t, n, i, a) {
    var l = i;
    if ((t & 1) === 0 && (t & 2) === 0 && i !== null)
      e: for (;;) {
        if (i === null) return;
        var r = i.tag;
        if (r === 3 || r === 4) {
          var s = i.stateNode.containerInfo;
          if (s === a) break;
          if (r === 4)
            for (r = i.return; r !== null;) {
              var u = r.tag;
              if ((u === 3 || u === 4) && r.stateNode.containerInfo === a) return;
              r = r.return;
            }
          for (; s !== null;) {
            if (((r = xi(s)), r === null)) return;
            if (((u = r.tag), u === 5 || u === 6 || u === 26 || u === 27)) {
              i = l = r;
              continue e;
            }
            s = s.parentNode;
          }
        }
        i = i.return;
      }
    Th(function () {
      var o = l,
        f = Do(n),
        m = [];
      e: {
        var d = Gh.get(e);
        if (d !== void 0) {
          var g = Vr,
            _ = e;
          switch (e) {
            case "keypress":
              if (ir(n) === 0) break e;
            case "keydown":
            case "keyup":
              g = op;
              break;
            case "focusin":
              ((_ = "focus"), (g = lu));
              break;
            case "focusout":
              ((_ = "blur"), (g = lu));
              break;
            case "beforeblur":
            case "afterblur":
              g = lu;
              break;
            case "click":
              if (n.button === 2) break e;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              g = Yf;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              g = Wv;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              g = dp;
              break;
            case qh:
            case Lh:
            case Hh:
              g = ep;
              break;
            case Bh:
              g = gp;
              break;
            case "scroll":
            case "scrollend":
              g = Zv;
              break;
            case "wheel":
              g = mp;
              break;
            case "copy":
            case "cut":
            case "paste":
              g = np;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              g = Vf;
              break;
            case "toggle":
            case "beforetoggle":
              g = pp;
          }
          var b = (t & 4) !== 0,
            A = !b && (e === "scroll" || e === "scrollend"),
            y = b ? (d !== null ? d + "Capture" : null) : d;
          b = [];
          for (var c = o, h; c !== null;) {
            var v = c;
            if (
              ((h = v.stateNode),
              (v = v.tag),
              (v !== 5 && v !== 26 && v !== 27) ||
                h === null ||
                y === null ||
                ((v = Wa(c, y)), v != null && b.push(rl(c, v, h))),
              A)
            )
              break;
            c = c.return;
          }
          0 < b.length && ((d = new g(d, _, null, n, f)), m.push({ event: d, listeners: b }));
        }
      }
      if ((t & 7) === 0) {
        e: {
          if (
            ((d = e === "mouseover" || e === "pointerover"),
            (g = e === "mouseout" || e === "pointerout"),
            d && n !== Ku && (_ = n.relatedTarget || n.fromElement) && (xi(_) || _[na]))
          )
            break e;
          if (
            (g || d) &&
            ((d = f.window === f ? f : (d = f.ownerDocument) ? d.defaultView || d.parentWindow : window),
            g
              ? ((_ = n.relatedTarget || n.toElement),
                (g = o),
                (_ = _ ? xi(_) : null),
                _ !== null && ((A = cl(_)), (b = _.tag), _ !== A || (b !== 5 && b !== 27 && b !== 6)) && (_ = null))
              : ((g = null), (_ = o)),
            g !== _)
          ) {
            if (
              ((b = Yf),
              (v = "onMouseLeave"),
              (y = "onMouseEnter"),
              (c = "mouse"),
              (e === "pointerout" || e === "pointerover") &&
                ((b = Vf), (v = "onPointerLeave"), (y = "onPointerEnter"), (c = "pointer")),
              (A = g == null ? d : za(g)),
              (h = _ == null ? d : za(_)),
              (d = new b(v, c + "leave", g, n, f)),
              (d.target = A),
              (d.relatedTarget = h),
              (v = null),
              xi(f) === o && ((b = new b(y, c + "enter", _, n, f)), (b.target = h), (b.relatedTarget = A), (v = b)),
              (A = v),
              g && _)
            )
              t: {
                for (b = y0, y = g, c = _, h = 0, v = y; v; v = b(v)) h++;
                v = 0;
                for (var E = c; E; E = b(E)) v++;
                for (; 0 < h - v;) ((y = b(y)), h--);
                for (; 0 < v - h;) ((c = b(c)), v--);
                for (; h--;) {
                  if (y === c || (c !== null && y === c.alternate)) {
                    b = y;
                    break t;
                  }
                  ((y = b(y)), (c = b(c)));
                }
                b = null;
              }
            else b = null;
            (g !== null && qd(m, d, g, b, !1), _ !== null && A !== null && qd(m, A, _, b, !0));
          }
        }
        e: {
          if (
            ((d = o ? za(o) : window),
            (g = d.nodeName && d.nodeName.toLowerCase()),
            g === "select" || (g === "input" && d.type === "file"))
          )
            var O = Zf;
          else if (Jf(d))
            if (Nh) O = xp;
            else {
              O = Tp;
              var w = Rp;
            }
          else
            ((g = d.nodeName),
              !g || g.toLowerCase() !== "input" || (d.type !== "checkbox" && d.type !== "radio")
                ? o && No(o.elementType) && (O = Zf)
                : (O = Op));
          if (O && (O = O(e, o))) {
            Uh(m, O, n, f);
            break e;
          }
          (w && w(e, d, o),
            e === "focusout" && o && d.type === "number" && o.memoizedProps.value != null && Gu(d, "number", d.value));
        }
        switch (((w = o ? za(o) : window), e)) {
          case "focusin":
            (Jf(w) || w.contentEditable === "true") && ((Ui = w), (Iu = o), (Ha = null));
            break;
          case "focusout":
            Ha = Iu = Ui = null;
            break;
          case "mousedown":
            Vu = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            ((Vu = !1), Pf(m, n, f));
            break;
          case "selectionchange":
            if (Cp) break;
          case "keydown":
          case "keyup":
            Pf(m, n, f);
        }
        var x;
        if (Mo)
          e: {
            switch (e) {
              case "compositionstart":
                var C = "onCompositionStart";
                break e;
              case "compositionend":
                C = "onCompositionEnd";
                break e;
              case "compositionupdate":
                C = "onCompositionUpdate";
                break e;
            }
            C = void 0;
          }
        else
          Ci
            ? kh(e, n) && (C = "onCompositionEnd")
            : e === "keydown" && n.keyCode === 229 && (C = "onCompositionStart");
        (C &&
          (xh &&
            n.locale !== "ko" &&
            (Ci || C !== "onCompositionStart"
              ? C === "onCompositionEnd" && Ci && (x = Oh())
              : ((un = f), (zo = "value" in un ? un.value : un.textContent), (Ci = !0))),
          (w = qr(o, C)),
          0 < w.length &&
            ((C = new If(C, e, null, n, f)),
            m.push({ event: C, listeners: w }),
            x ? (C.data = x) : ((x = Ch(n)), x !== null && (C.data = x)))),
          (x = bp ? wp(e, n) : Sp(e, n)) &&
            ((C = qr(o, "onBeforeInput")),
            0 < C.length &&
              ((w = new If("onBeforeInput", "beforeinput", null, n, f)),
              m.push({ event: w, listeners: C }),
              (w.data = x))),
          h0(m, e, o, n, f));
      }
      Ty(m, t);
    });
  }
  function rl(e, t, n) {
    return { instance: e, listener: t, currentTarget: n };
  }
  function qr(e, t) {
    for (var n = t + "Capture", i = []; e !== null;) {
      var a = e,
        l = a.stateNode;
      if (
        ((a = a.tag),
        (a !== 5 && a !== 26 && a !== 27) ||
          l === null ||
          ((a = Wa(e, n)), a != null && i.unshift(rl(e, a, l)), (a = Wa(e, t)), a != null && i.push(rl(e, a, l))),
        e.tag === 3)
      )
        return i;
      e = e.return;
    }
    return [];
  }
  function y0(e) {
    if (e === null) return null;
    do e = e.return;
    while (e && e.tag !== 5 && e.tag !== 27);
    return e || null;
  }
  function qd(e, t, n, i, a) {
    for (var l = t._reactName, r = []; n !== null && n !== i;) {
      var s = n,
        u = s.alternate,
        o = s.stateNode;
      if (((s = s.tag), u !== null && u === i)) break;
      ((s !== 5 && s !== 26 && s !== 27) ||
        o === null ||
        ((u = o),
        a
          ? ((o = Wa(n, l)), o != null && r.unshift(rl(n, o, u)))
          : a || ((o = Wa(n, l)), o != null && r.push(rl(n, o, u)))),
        (n = n.return));
    }
    r.length !== 0 && e.push({ event: t, listeners: r });
  }
  var m0 = /\r\n?/g,
    v0 = /\u0000|\uFFFD/g;
  function Ld(e) {
    return (typeof e == "string" ? e : "" + e)
      .replace(
        m0,
        `
`,
      )
      .replace(v0, "");
  }
  function xy(e, t) {
    return ((t = Ld(t)), Ld(e) === t);
  }
  function Y(e, t, n, i, a, l) {
    switch (n) {
      case "children":
        typeof i == "string"
          ? t === "body" || (t === "textarea" && i === "") || Qi(e, i)
          : (typeof i == "number" || typeof i == "bigint") && t !== "body" && Qi(e, "" + i);
        break;
      case "className":
        Bl(e, "class", i);
        break;
      case "tabIndex":
        Bl(e, "tabindex", i);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        Bl(e, n, i);
        break;
      case "style":
        Rh(e, i, l);
        break;
      case "data":
        if (t !== "object") {
          Bl(e, "data", i);
          break;
        }
      case "src":
      case "href":
        if (i === "" && (t !== "a" || n !== "href")) {
          e.removeAttribute(n);
          break;
        }
        if (i == null || typeof i == "function" || typeof i == "symbol" || typeof i == "boolean") {
          e.removeAttribute(n);
          break;
        }
        ((i = tr("" + i)), e.setAttribute(n, i));
        break;
      case "action":
      case "formAction":
        if (typeof i == "function") {
          e.setAttribute(
            n,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')",
          );
          break;
        } else
          typeof l == "function" &&
            (n === "formAction"
              ? (t !== "input" && Y(e, t, "name", a.name, a, null),
                Y(e, t, "formEncType", a.formEncType, a, null),
                Y(e, t, "formMethod", a.formMethod, a, null),
                Y(e, t, "formTarget", a.formTarget, a, null))
              : (Y(e, t, "encType", a.encType, a, null),
                Y(e, t, "method", a.method, a, null),
                Y(e, t, "target", a.target, a, null)));
        if (i == null || typeof i == "symbol" || typeof i == "boolean") {
          e.removeAttribute(n);
          break;
        }
        ((i = tr("" + i)), e.setAttribute(n, i));
        break;
      case "onClick":
        i != null && (e.onclick = qt);
        break;
      case "onScroll":
        i != null && z("scroll", e);
        break;
      case "onScrollEnd":
        i != null && z("scrollend", e);
        break;
      case "dangerouslySetInnerHTML":
        if (i != null) {
          if (typeof i != "object" || !("__html" in i)) throw Error(p(61));
          if (((n = i.__html), n != null)) {
            if (a.children != null) throw Error(p(60));
            e.innerHTML = n;
          }
        }
        break;
      case "multiple":
        e.multiple = i && typeof i != "function" && typeof i != "symbol";
        break;
      case "muted":
        e.muted = i && typeof i != "function" && typeof i != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (i == null || typeof i == "function" || typeof i == "boolean" || typeof i == "symbol") {
          e.removeAttribute("xlink:href");
          break;
        }
        ((n = tr("" + i)), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n));
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        i != null && typeof i != "function" && typeof i != "symbol" ? e.setAttribute(n, "" + i) : e.removeAttribute(n);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        i && typeof i != "function" && typeof i != "symbol" ? e.setAttribute(n, "") : e.removeAttribute(n);
        break;
      case "capture":
      case "download":
        i === !0
          ? e.setAttribute(n, "")
          : i !== !1 && i != null && typeof i != "function" && typeof i != "symbol"
            ? e.setAttribute(n, i)
            : e.removeAttribute(n);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        i != null && typeof i != "function" && typeof i != "symbol" && !isNaN(i) && 1 <= i
          ? e.setAttribute(n, i)
          : e.removeAttribute(n);
        break;
      case "rowSpan":
      case "start":
        i == null || typeof i == "function" || typeof i == "symbol" || isNaN(i)
          ? e.removeAttribute(n)
          : e.setAttribute(n, i);
        break;
      case "popover":
        (z("beforetoggle", e), z("toggle", e), er(e, "popover", i));
        break;
      case "xlinkActuate":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:actuate", i);
        break;
      case "xlinkArcrole":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", i);
        break;
      case "xlinkRole":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:role", i);
        break;
      case "xlinkShow":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:show", i);
        break;
      case "xlinkTitle":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:title", i);
        break;
      case "xlinkType":
        kt(e, "http://www.w3.org/1999/xlink", "xlink:type", i);
        break;
      case "xmlBase":
        kt(e, "http://www.w3.org/XML/1998/namespace", "xml:base", i);
        break;
      case "xmlLang":
        kt(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", i);
        break;
      case "xmlSpace":
        kt(e, "http://www.w3.org/XML/1998/namespace", "xml:space", i);
        break;
      case "is":
        er(e, "is", i);
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        (!(2 < n.length) || (n[0] !== "o" && n[0] !== "O") || (n[1] !== "n" && n[1] !== "N")) &&
          ((n = Qv.get(n) || n), er(e, n, i));
    }
  }
  function mo(e, t, n, i, a, l) {
    switch (n) {
      case "style":
        Rh(e, i, l);
        break;
      case "dangerouslySetInnerHTML":
        if (i != null) {
          if (typeof i != "object" || !("__html" in i)) throw Error(p(61));
          if (((n = i.__html), n != null)) {
            if (a.children != null) throw Error(p(60));
            e.innerHTML = n;
          }
        }
        break;
      case "children":
        typeof i == "string" ? Qi(e, i) : (typeof i == "number" || typeof i == "bigint") && Qi(e, "" + i);
        break;
      case "onScroll":
        i != null && z("scroll", e);
        break;
      case "onScrollEnd":
        i != null && z("scrollend", e);
        break;
      case "onClick":
        i != null && (e.onclick = qt);
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        if (!_h.hasOwnProperty(n))
          e: {
            if (
              n[0] === "o" &&
              n[1] === "n" &&
              ((a = n.endsWith("Capture")),
              (t = n.slice(2, a ? n.length - 7 : void 0)),
              (l = e[Le] || null),
              (l = l != null ? l[n] : null),
              typeof l == "function" && e.removeEventListener(t, l, a),
              typeof i == "function")
            ) {
              (typeof l != "function" &&
                l !== null &&
                (n in e ? (e[n] = null) : e.hasAttribute(n) && e.removeAttribute(n)),
                e.addEventListener(t, i, a));
              break e;
            }
            n in e ? (e[n] = i) : i === !0 ? e.setAttribute(n, "") : er(e, n, i);
          }
    }
  }
  function Ae(e, t, n) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        (z("error", e), z("load", e));
        var i = !1,
          a = !1,
          l;
        for (l in n)
          if (n.hasOwnProperty(l)) {
            var r = n[l];
            if (r != null)
              switch (l) {
                case "src":
                  i = !0;
                  break;
                case "srcSet":
                  a = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(p(137, t));
                default:
                  Y(e, t, l, r, n, null);
              }
          }
        (a && Y(e, t, "srcSet", n.srcSet, n, null), i && Y(e, t, "src", n.src, n, null));
        return;
      case "input":
        z("invalid", e);
        var s = (l = r = a = null),
          u = null,
          o = null;
        for (i in n)
          if (n.hasOwnProperty(i)) {
            var f = n[i];
            if (f != null)
              switch (i) {
                case "name":
                  a = f;
                  break;
                case "type":
                  r = f;
                  break;
                case "checked":
                  u = f;
                  break;
                case "defaultChecked":
                  o = f;
                  break;
                case "value":
                  l = f;
                  break;
                case "defaultValue":
                  s = f;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (f != null) throw Error(p(137, t));
                  break;
                default:
                  Y(e, t, i, f, n, null);
              }
          }
        Sh(e, l, s, u, o, r, a, !1);
        return;
      case "select":
        (z("invalid", e), (i = r = l = null));
        for (a in n)
          if (n.hasOwnProperty(a) && ((s = n[a]), s != null))
            switch (a) {
              case "value":
                l = s;
                break;
              case "defaultValue":
                r = s;
                break;
              case "multiple":
                i = s;
              default:
                Y(e, t, a, s, n, null);
            }
        ((t = l), (n = r), (e.multiple = !!i), t != null ? Hi(e, !!i, t, !1) : n != null && Hi(e, !!i, n, !0));
        return;
      case "textarea":
        (z("invalid", e), (l = a = i = null));
        for (r in n)
          if (n.hasOwnProperty(r) && ((s = n[r]), s != null))
            switch (r) {
              case "value":
                i = s;
                break;
              case "defaultValue":
                a = s;
                break;
              case "children":
                l = s;
                break;
              case "dangerouslySetInnerHTML":
                if (s != null) throw Error(p(91));
                break;
              default:
                Y(e, t, r, s, n, null);
            }
        Ah(e, i, a, l);
        return;
      case "option":
        for (u in n)
          if (n.hasOwnProperty(u) && ((i = n[u]), i != null))
            switch (u) {
              case "selected":
                e.selected = i && typeof i != "function" && typeof i != "symbol";
                break;
              default:
                Y(e, t, u, i, n, null);
            }
        return;
      case "dialog":
        (z("beforetoggle", e), z("toggle", e), z("cancel", e), z("close", e));
        break;
      case "iframe":
      case "object":
        z("load", e);
        break;
      case "video":
      case "audio":
        for (i = 0; i < ll.length; i++) z(ll[i], e);
        break;
      case "image":
        (z("error", e), z("load", e));
        break;
      case "details":
        z("toggle", e);
        break;
      case "embed":
      case "source":
      case "link":
        (z("error", e), z("load", e));
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (o in n)
          if (n.hasOwnProperty(o) && ((i = n[o]), i != null))
            switch (o) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(p(137, t));
              default:
                Y(e, t, o, i, n, null);
            }
        return;
      default:
        if (No(t)) {
          for (f in n) n.hasOwnProperty(f) && ((i = n[f]), i !== void 0 && mo(e, t, f, i, n, void 0));
          return;
        }
    }
    for (s in n) n.hasOwnProperty(s) && ((i = n[s]), i != null && Y(e, t, s, i, n, null));
  }
  function p0(e, t, n, i) {
    switch (t) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var a = null,
          l = null,
          r = null,
          s = null,
          u = null,
          o = null,
          f = null;
        for (g in n) {
          var m = n[g];
          if (n.hasOwnProperty(g) && m != null)
            switch (g) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                u = m;
              default:
                i.hasOwnProperty(g) || Y(e, t, g, null, i, m);
            }
        }
        for (var d in i) {
          var g = i[d];
          if (((m = n[d]), i.hasOwnProperty(d) && (g != null || m != null)))
            switch (d) {
              case "type":
                l = g;
                break;
              case "name":
                a = g;
                break;
              case "checked":
                o = g;
                break;
              case "defaultChecked":
                f = g;
                break;
              case "value":
                r = g;
                break;
              case "defaultValue":
                s = g;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (g != null) throw Error(p(137, t));
                break;
              default:
                g !== m && Y(e, t, d, g, i, m);
            }
        }
        Bu(e, r, s, u, o, f, l, a);
        return;
      case "select":
        g = r = s = d = null;
        for (l in n)
          if (((u = n[l]), n.hasOwnProperty(l) && u != null))
            switch (l) {
              case "value":
                break;
              case "multiple":
                g = u;
              default:
                i.hasOwnProperty(l) || Y(e, t, l, null, i, u);
            }
        for (a in i)
          if (((l = i[a]), (u = n[a]), i.hasOwnProperty(a) && (l != null || u != null)))
            switch (a) {
              case "value":
                d = l;
                break;
              case "defaultValue":
                s = l;
                break;
              case "multiple":
                r = l;
              default:
                l !== u && Y(e, t, a, l, i, u);
            }
        ((t = s),
          (n = r),
          (i = g),
          d != null ? Hi(e, !!n, d, !1) : !!i != !!n && (t != null ? Hi(e, !!n, t, !0) : Hi(e, !!n, n ? [] : "", !1)));
        return;
      case "textarea":
        g = d = null;
        for (s in n)
          if (((a = n[s]), n.hasOwnProperty(s) && a != null && !i.hasOwnProperty(s)))
            switch (s) {
              case "value":
                break;
              case "children":
                break;
              default:
                Y(e, t, s, null, i, a);
            }
        for (r in i)
          if (((a = i[r]), (l = n[r]), i.hasOwnProperty(r) && (a != null || l != null)))
            switch (r) {
              case "value":
                d = a;
                break;
              case "defaultValue":
                g = a;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (a != null) throw Error(p(91));
                break;
              default:
                a !== l && Y(e, t, r, a, i, l);
            }
        Eh(e, d, g);
        return;
      case "option":
        for (var _ in n)
          if (((d = n[_]), n.hasOwnProperty(_) && d != null && !i.hasOwnProperty(_)))
            switch (_) {
              case "selected":
                e.selected = !1;
                break;
              default:
                Y(e, t, _, null, i, d);
            }
        for (u in i)
          if (((d = i[u]), (g = n[u]), i.hasOwnProperty(u) && d !== g && (d != null || g != null)))
            switch (u) {
              case "selected":
                e.selected = d && typeof d != "function" && typeof d != "symbol";
                break;
              default:
                Y(e, t, u, d, i, g);
            }
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var b in n)
          ((d = n[b]), n.hasOwnProperty(b) && d != null && !i.hasOwnProperty(b) && Y(e, t, b, null, i, d));
        for (o in i)
          if (((d = i[o]), (g = n[o]), i.hasOwnProperty(o) && d !== g && (d != null || g != null)))
            switch (o) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (d != null) throw Error(p(137, t));
                break;
              default:
                Y(e, t, o, d, i, g);
            }
        return;
      default:
        if (No(t)) {
          for (var A in n)
            ((d = n[A]), n.hasOwnProperty(A) && d !== void 0 && !i.hasOwnProperty(A) && mo(e, t, A, void 0, i, d));
          for (f in i)
            ((d = i[f]),
              (g = n[f]),
              !i.hasOwnProperty(f) || d === g || (d === void 0 && g === void 0) || mo(e, t, f, d, i, g));
          return;
        }
    }
    for (var y in n) ((d = n[y]), n.hasOwnProperty(y) && d != null && !i.hasOwnProperty(y) && Y(e, t, y, null, i, d));
    for (m in i)
      ((d = i[m]), (g = n[m]), !i.hasOwnProperty(m) || d === g || (d == null && g == null) || Y(e, t, m, d, i, g));
  }
  function Hd(e) {
    switch (e) {
      case "css":
      case "script":
      case "font":
      case "img":
      case "image":
      case "input":
      case "link":
        return !0;
      default:
        return !1;
    }
  }
  function _0() {
    if (typeof performance.getEntriesByType == "function") {
      for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), i = 0; i < n.length; i++) {
        var a = n[i],
          l = a.transferSize,
          r = a.initiatorType,
          s = a.duration;
        if (l && s && Hd(r)) {
          for (r = 0, s = a.responseEnd, i += 1; i < n.length; i++) {
            var u = n[i],
              o = u.startTime;
            if (o > s) break;
            var f = u.transferSize,
              m = u.initiatorType;
            f && Hd(m) && ((u = u.responseEnd), (r += f * (u < s ? 1 : (s - o) / (u - o))));
          }
          if ((--i, (t += (8 * (l + r)) / (a.duration / 1e3)), e++, 10 < e)) break;
        }
      }
      if (0 < e) return t / e / 1e6;
    }
    return navigator.connection && ((e = navigator.connection.downlink), typeof e == "number") ? e : 5;
  }
  var vo = null,
    po = null;
  function Lr(e) {
    return e.nodeType === 9 ? e : e.ownerDocument;
  }
  function Bd(e) {
    switch (e) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function ky(e, t) {
    if (e === 0)
      switch (t) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return e === 1 && t === "foreignObject" ? 0 : e;
  }
  function _o(e, t) {
    return (
      e === "textarea" ||
      e === "noscript" ||
      typeof t.children == "string" ||
      typeof t.children == "number" ||
      typeof t.children == "bigint" ||
      (typeof t.dangerouslySetInnerHTML == "object" &&
        t.dangerouslySetInnerHTML !== null &&
        t.dangerouslySetInnerHTML.__html != null)
    );
  }
  var xu = null;
  function b0() {
    var e = window.event;
    return e && e.type === "popstate" ? (e === xu ? !1 : ((xu = e), !0)) : ((xu = null), !1);
  }
  var Cy = typeof setTimeout == "function" ? setTimeout : void 0,
    w0 = typeof clearTimeout == "function" ? clearTimeout : void 0,
    Gd = typeof Promise == "function" ? Promise : void 0,
    S0 =
      typeof queueMicrotask == "function"
        ? queueMicrotask
        : typeof Gd < "u"
          ? function (e) {
              return Gd.resolve(null).then(e).catch(E0);
            }
          : Cy;
  function E0(e) {
    setTimeout(function () {
      throw e;
    });
  }
  function Tn(e) {
    return e === "head";
  }
  function Kd(e, t) {
    var n = t,
      i = 0;
    do {
      var a = n.nextSibling;
      if ((e.removeChild(n), a && a.nodeType === 8))
        if (((n = a.data), n === "/$" || n === "/&")) {
          if (i === 0) {
            (e.removeChild(a), ta(t));
            return;
          }
          i--;
        } else if (n === "$" || n === "$?" || n === "$~" || n === "$!" || n === "&") i++;
        else if (n === "html") Za(e.ownerDocument.documentElement);
        else if (n === "head") {
          ((n = e.ownerDocument.head), Za(n));
          for (var l = n.firstChild; l;) {
            var r = l.nextSibling,
              s = l.nodeName;
            (l[gl] ||
              s === "SCRIPT" ||
              s === "STYLE" ||
              (s === "LINK" && l.rel.toLowerCase() === "stylesheet") ||
              n.removeChild(l),
              (l = r));
          }
        } else n === "body" && Za(e.ownerDocument.body);
      n = a;
    } while (n);
    ta(t);
  }
  function Yd(e, t) {
    var n = e;
    e = 0;
    do {
      var i = n.nextSibling;
      if (
        (n.nodeType === 1
          ? t
            ? ((n._stashedDisplay = n.style.display), (n.style.display = "none"))
            : ((n.style.display = n._stashedDisplay || ""),
              n.getAttribute("style") === "" && n.removeAttribute("style"))
          : n.nodeType === 3 &&
            (t ? ((n._stashedText = n.nodeValue), (n.nodeValue = "")) : (n.nodeValue = n._stashedText || "")),
        i && i.nodeType === 8)
      )
        if (((n = i.data), n === "/$")) {
          if (e === 0) break;
          e--;
        } else (n !== "$" && n !== "$?" && n !== "$~" && n !== "$!") || e++;
      n = i;
    } while (n);
  }
  function bo(e) {
    var t = e.firstChild;
    for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
      var n = t;
      switch (((t = t.nextSibling), n.nodeName)) {
        case "HTML":
        case "HEAD":
        case "BODY":
          (bo(n), Uo(n));
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (n.rel.toLowerCase() === "stylesheet") continue;
      }
      e.removeChild(n);
    }
  }
  function A0(e, t, n, i) {
    for (; e.nodeType === 1;) {
      var a = n;
      if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
        if (!i && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
      } else if (i) {
        if (!e[gl])
          switch (t) {
            case "meta":
              if (!e.hasAttribute("itemprop")) break;
              return e;
            case "link":
              if (((l = e.getAttribute("rel")), l === "stylesheet" && e.hasAttribute("data-precedence"))) break;
              if (
                l !== a.rel ||
                e.getAttribute("href") !== (a.href == null || a.href === "" ? null : a.href) ||
                e.getAttribute("crossorigin") !== (a.crossOrigin == null ? null : a.crossOrigin) ||
                e.getAttribute("title") !== (a.title == null ? null : a.title)
              )
                break;
              return e;
            case "style":
              if (e.hasAttribute("data-precedence")) break;
              return e;
            case "script":
              if (
                ((l = e.getAttribute("src")),
                (l !== (a.src == null ? null : a.src) ||
                  e.getAttribute("type") !== (a.type == null ? null : a.type) ||
                  e.getAttribute("crossorigin") !== (a.crossOrigin == null ? null : a.crossOrigin)) &&
                  l &&
                  e.hasAttribute("async") &&
                  !e.hasAttribute("itemprop"))
              )
                break;
              return e;
            default:
              return e;
          }
      } else if (t === "input" && e.type === "hidden") {
        var l = a.name == null ? null : "" + a.name;
        if (a.type === "hidden" && e.getAttribute("name") === l) return e;
      } else return e;
      if (((e = st(e.nextSibling)), e === null)) break;
    }
    return null;
  }
  function R0(e, t, n) {
    if (t === "") return null;
    for (; e.nodeType !== 3;)
      if (
        ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n) ||
        ((e = st(e.nextSibling)), e === null)
      )
        return null;
    return e;
  }
  function Uy(e, t) {
    for (; e.nodeType !== 8;)
      if (
        ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t) ||
        ((e = st(e.nextSibling)), e === null)
      )
        return null;
    return e;
  }
  function wo(e) {
    return e.data === "$?" || e.data === "$~";
  }
  function So(e) {
    return e.data === "$!" || (e.data === "$?" && e.ownerDocument.readyState !== "loading");
  }
  function T0(e, t) {
    var n = e.ownerDocument;
    if (e.data === "$~") e._reactRetry = t;
    else if (e.data !== "$?" || n.readyState !== "loading") t();
    else {
      var i = function () {
        (t(), n.removeEventListener("DOMContentLoaded", i));
      };
      (n.addEventListener("DOMContentLoaded", i), (e._reactRetry = i));
    }
  }
  function st(e) {
    for (; e != null; e = e.nextSibling) {
      var t = e.nodeType;
      if (t === 1 || t === 3) break;
      if (t === 8) {
        if (((t = e.data), t === "$" || t === "$!" || t === "$?" || t === "$~" || t === "&" || t === "F!" || t === "F"))
          break;
        if (t === "/$" || t === "/&") return null;
      }
    }
    return e;
  }
  var Eo = null;
  function Id(e) {
    e = e.nextSibling;
    for (var t = 0; e;) {
      if (e.nodeType === 8) {
        var n = e.data;
        if (n === "/$" || n === "/&") {
          if (t === 0) return st(e.nextSibling);
          t--;
        } else (n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&") || t++;
      }
      e = e.nextSibling;
    }
    return null;
  }
  function Vd(e) {
    e = e.previousSibling;
    for (var t = 0; e;) {
      if (e.nodeType === 8) {
        var n = e.data;
        if (n === "$" || n === "$!" || n === "$?" || n === "$~" || n === "&") {
          if (t === 0) return e;
          t--;
        } else (n !== "/$" && n !== "/&") || t++;
      }
      e = e.previousSibling;
    }
    return null;
  }
  function Ny(e, t, n) {
    switch (((t = Lr(n)), e)) {
      case "html":
        if (((e = t.documentElement), !e)) throw Error(p(452));
        return e;
      case "head":
        if (((e = t.head), !e)) throw Error(p(453));
        return e;
      case "body":
        if (((e = t.body), !e)) throw Error(p(454));
        return e;
      default:
        throw Error(p(451));
    }
  }
  function Za(e) {
    for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
    Uo(e);
  }
  var ut = new Map(),
    Xd = new Set();
  function Hr(e) {
    return typeof e.getRootNode == "function" ? e.getRootNode() : e.nodeType === 9 ? e : e.ownerDocument;
  }
  var Qt = B.d;
  B.d = { f: O0, r: x0, D: k0, C: C0, L: U0, m: N0, X: z0, S: D0, M: j0 };
  function O0() {
    var e = Qt.f(),
      t = ns();
    return e || t;
  }
  function x0(e) {
    var t = ia(e);
    t !== null && t.tag === 5 && t.type === "form" ? Rg(t) : Qt.r(e);
  }
  var sa = typeof document > "u" ? null : document;
  function Dy(e, t, n) {
    var i = sa;
    if (i && typeof t == "string" && t) {
      var a = it(t);
      ((a = 'link[rel="' + e + '"][href="' + a + '"]'),
        typeof n == "string" && (a += '[crossorigin="' + n + '"]'),
        Xd.has(a) ||
          (Xd.add(a),
          (e = { rel: e, crossOrigin: n, href: t }),
          i.querySelector(a) === null &&
            ((t = i.createElement("link")), Ae(t, "link", e), ve(t), i.head.appendChild(t))));
    }
  }
  function k0(e) {
    (Qt.D(e), Dy("dns-prefetch", e, null));
  }
  function C0(e, t) {
    (Qt.C(e, t), Dy("preconnect", e, t));
  }
  function U0(e, t, n) {
    Qt.L(e, t, n);
    var i = sa;
    if (i && e && t) {
      var a = 'link[rel="preload"][as="' + it(t) + '"]';
      t === "image" && n && n.imageSrcSet
        ? ((a += '[imagesrcset="' + it(n.imageSrcSet) + '"]'),
          typeof n.imageSizes == "string" && (a += '[imagesizes="' + it(n.imageSizes) + '"]'))
        : (a += '[href="' + it(e) + '"]');
      var l = a;
      switch (t) {
        case "style":
          l = ea(e);
          break;
        case "script":
          l = ua(e);
      }
      ut.has(l) ||
        ((e = $({ rel: "preload", href: t === "image" && n && n.imageSrcSet ? void 0 : e, as: t }, n)),
        ut.set(l, e),
        i.querySelector(a) !== null ||
          (t === "style" && i.querySelector(bl(l))) ||
          (t === "script" && i.querySelector(wl(l))) ||
          ((t = i.createElement("link")), Ae(t, "link", e), ve(t), i.head.appendChild(t)));
    }
  }
  function N0(e, t) {
    Qt.m(e, t);
    var n = sa;
    if (n && e) {
      var i = t && typeof t.as == "string" ? t.as : "script",
        a = 'link[rel="modulepreload"][as="' + it(i) + '"][href="' + it(e) + '"]',
        l = a;
      switch (i) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          l = ua(e);
      }
      if (!ut.has(l) && ((e = $({ rel: "modulepreload", href: e }, t)), ut.set(l, e), n.querySelector(a) === null)) {
        switch (i) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (n.querySelector(wl(l))) return;
        }
        ((i = n.createElement("link")), Ae(i, "link", e), ve(i), n.head.appendChild(i));
      }
    }
  }
  function D0(e, t, n) {
    Qt.S(e, t, n);
    var i = sa;
    if (i && e) {
      var a = Li(i).hoistableStyles,
        l = ea(e);
      t = t || "default";
      var r = a.get(l);
      if (!r) {
        var s = { loading: 0, preload: null };
        if ((r = i.querySelector(bl(l)))) s.loading = 5;
        else {
          ((e = $({ rel: "stylesheet", href: e, "data-precedence": t }, n)), (n = ut.get(l)) && mc(e, n));
          var u = (r = i.createElement("link"));
          (ve(u),
            Ae(u, "link", e),
            (u._p = new Promise(function (o, f) {
              ((u.onload = o), (u.onerror = f));
            })),
            u.addEventListener("load", function () {
              s.loading |= 1;
            }),
            u.addEventListener("error", function () {
              s.loading |= 2;
            }),
            (s.loading |= 4),
            fr(r, t, i));
        }
        ((r = { type: "stylesheet", instance: r, count: 1, state: s }), a.set(l, r));
      }
    }
  }
  function z0(e, t) {
    Qt.X(e, t);
    var n = sa;
    if (n && e) {
      var i = Li(n).hoistableScripts,
        a = ua(e),
        l = i.get(a);
      l ||
        ((l = n.querySelector(wl(a))),
        l ||
          ((e = $({ src: e, async: !0 }, t)),
          (t = ut.get(a)) && vc(e, t),
          (l = n.createElement("script")),
          ve(l),
          Ae(l, "link", e),
          n.head.appendChild(l)),
        (l = { type: "script", instance: l, count: 1, state: null }),
        i.set(a, l));
    }
  }
  function j0(e, t) {
    Qt.M(e, t);
    var n = sa;
    if (n && e) {
      var i = Li(n).hoistableScripts,
        a = ua(e),
        l = i.get(a);
      l ||
        ((l = n.querySelector(wl(a))),
        l ||
          ((e = $({ src: e, async: !0, type: "module" }, t)),
          (t = ut.get(a)) && vc(e, t),
          (l = n.createElement("script")),
          ve(l),
          Ae(l, "link", e),
          n.head.appendChild(l)),
        (l = { type: "script", instance: l, count: 1, state: null }),
        i.set(a, l));
    }
  }
  function Qd(e, t, n, i) {
    var a = (a = dn.current) ? Hr(a) : null;
    if (!a) throw Error(p(446));
    switch (e) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof n.precedence == "string" && typeof n.href == "string"
          ? ((t = ea(n.href)),
            (n = Li(a).hoistableStyles),
            (i = n.get(t)),
            i || ((i = { type: "style", instance: null, count: 0, state: null }), n.set(t, i)),
            i)
          : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
          e = ea(n.href);
          var l = Li(a).hoistableStyles,
            r = l.get(e);
          if (
            (r ||
              ((a = a.ownerDocument || a),
              (r = { type: "stylesheet", instance: null, count: 0, state: { loading: 0, preload: null } }),
              l.set(e, r),
              (l = a.querySelector(bl(e))) && !l._p && ((r.instance = l), (r.state.loading = 5)),
              ut.has(e) ||
                ((n = {
                  rel: "preload",
                  as: "style",
                  href: n.href,
                  crossOrigin: n.crossOrigin,
                  integrity: n.integrity,
                  media: n.media,
                  hrefLang: n.hrefLang,
                  referrerPolicy: n.referrerPolicy,
                }),
                ut.set(e, n),
                l || M0(a, e, n, r.state))),
            t && i === null)
          )
            throw Error(p(528, ""));
          return r;
        }
        if (t && i !== null) throw Error(p(529, ""));
        return null;
      case "script":
        return (
          (t = n.async),
          (n = n.src),
          typeof n == "string" && t && typeof t != "function" && typeof t != "symbol"
            ? ((t = ua(n)),
              (n = Li(a).hoistableScripts),
              (i = n.get(t)),
              i || ((i = { type: "script", instance: null, count: 0, state: null }), n.set(t, i)),
              i)
            : { type: "void", instance: null, count: 0, state: null }
        );
      default:
        throw Error(p(444, e));
    }
  }
  function ea(e) {
    return 'href="' + it(e) + '"';
  }
  function bl(e) {
    return 'link[rel="stylesheet"][' + e + "]";
  }
  function zy(e) {
    return $({}, e, { "data-precedence": e.precedence, precedence: null });
  }
  function M0(e, t, n, i) {
    e.querySelector('link[rel="preload"][as="style"][' + t + "]")
      ? (i.loading = 1)
      : ((t = e.createElement("link")),
        (i.preload = t),
        t.addEventListener("load", function () {
          return (i.loading |= 1);
        }),
        t.addEventListener("error", function () {
          return (i.loading |= 2);
        }),
        Ae(t, "link", n),
        ve(t),
        e.head.appendChild(t));
  }
  function ua(e) {
    return '[src="' + it(e) + '"]';
  }
  function wl(e) {
    return "script[async]" + e;
  }
  function Jd(e, t, n) {
    if ((t.count++, t.instance === null))
      switch (t.type) {
        case "style":
          var i = e.querySelector('style[data-href~="' + it(n.href) + '"]');
          if (i) return ((t.instance = i), ve(i), i);
          var a = $({}, n, { "data-href": n.href, "data-precedence": n.precedence, href: null, precedence: null });
          return (
            (i = (e.ownerDocument || e).createElement("style")),
            ve(i),
            Ae(i, "style", a),
            fr(i, n.precedence, e),
            (t.instance = i)
          );
        case "stylesheet":
          a = ea(n.href);
          var l = e.querySelector(bl(a));
          if (l) return ((t.state.loading |= 4), (t.instance = l), ve(l), l);
          ((i = zy(n)), (a = ut.get(a)) && mc(i, a), (l = (e.ownerDocument || e).createElement("link")), ve(l));
          var r = l;
          return (
            (r._p = new Promise(function (s, u) {
              ((r.onload = s), (r.onerror = u));
            })),
            Ae(l, "link", i),
            (t.state.loading |= 4),
            fr(l, n.precedence, e),
            (t.instance = l)
          );
        case "script":
          return (
            (l = ua(n.src)),
            (a = e.querySelector(wl(l)))
              ? ((t.instance = a), ve(a), a)
              : ((i = n),
                (a = ut.get(l)) && ((i = $({}, n)), vc(i, a)),
                (e = e.ownerDocument || e),
                (a = e.createElement("script")),
                ve(a),
                Ae(a, "link", i),
                e.head.appendChild(a),
                (t.instance = a))
          );
        case "void":
          return null;
        default:
          throw Error(p(443, t.type));
      }
    else
      t.type === "stylesheet" &&
        (t.state.loading & 4) === 0 &&
        ((i = t.instance), (t.state.loading |= 4), fr(i, n.precedence, e));
    return t.instance;
  }
  function fr(e, t, n) {
    for (
      var i = n.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),
        a = i.length ? i[i.length - 1] : null,
        l = a,
        r = 0;
      r < i.length;
      r++
    ) {
      var s = i[r];
      if (s.dataset.precedence === t) l = s;
      else if (l !== a) break;
    }
    l
      ? l.parentNode.insertBefore(e, l.nextSibling)
      : ((t = n.nodeType === 9 ? n.head : n), t.insertBefore(e, t.firstChild));
  }
  function mc(e, t) {
    (e.crossOrigin == null && (e.crossOrigin = t.crossOrigin),
      e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy),
      e.title == null && (e.title = t.title));
  }
  function vc(e, t) {
    (e.crossOrigin == null && (e.crossOrigin = t.crossOrigin),
      e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy),
      e.integrity == null && (e.integrity = t.integrity));
  }
  var dr = null;
  function Zd(e, t, n) {
    if (dr === null) {
      var i = new Map(),
        a = (dr = new Map());
      a.set(n, i);
    } else ((a = dr), (i = a.get(n)), i || ((i = new Map()), a.set(n, i)));
    if (i.has(e)) return i;
    for (i.set(e, null), n = n.getElementsByTagName(e), a = 0; a < n.length; a++) {
      var l = n[a];
      if (
        !(l[gl] || l[we] || (e === "link" && l.getAttribute("rel") === "stylesheet")) &&
        l.namespaceURI !== "http://www.w3.org/2000/svg"
      ) {
        var r = l.getAttribute(t) || "";
        r = e + r;
        var s = i.get(r);
        s ? s.push(l) : i.set(r, [l]);
      }
    }
    return i;
  }
  function $d(e, t, n) {
    ((e = e.ownerDocument || e), e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null));
  }
  function q0(e, t, n) {
    if (n === 1 || t.itemProp != null) return !1;
    switch (e) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
        return !0;
      case "link":
        if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError) break;
        switch (t.rel) {
          case "stylesheet":
            return ((e = t.disabled), typeof t.precedence == "string" && e == null);
          default:
            return !0;
        }
      case "script":
        if (
          t.async &&
          typeof t.async != "function" &&
          typeof t.async != "symbol" &&
          !t.onLoad &&
          !t.onError &&
          t.src &&
          typeof t.src == "string"
        )
          return !0;
    }
    return !1;
  }
  function jy(e) {
    return !(e.type === "stylesheet" && (e.state.loading & 3) === 0);
  }
  function L0(e, t, n, i) {
    if (
      n.type === "stylesheet" &&
      (typeof i.media != "string" || matchMedia(i.media).matches !== !1) &&
      (n.state.loading & 4) === 0
    ) {
      if (n.instance === null) {
        var a = ea(i.href),
          l = t.querySelector(bl(a));
        if (l) {
          ((t = l._p),
            t !== null &&
              typeof t == "object" &&
              typeof t.then == "function" &&
              (e.count++, (e = Br.bind(e)), t.then(e, e)),
            (n.state.loading |= 4),
            (n.instance = l),
            ve(l));
          return;
        }
        ((l = t.ownerDocument || t), (i = zy(i)), (a = ut.get(a)) && mc(i, a), (l = l.createElement("link")), ve(l));
        var r = l;
        ((r._p = new Promise(function (s, u) {
          ((r.onload = s), (r.onerror = u));
        })),
          Ae(l, "link", i),
          (n.instance = l));
      }
      (e.stylesheets === null && (e.stylesheets = new Map()),
        e.stylesheets.set(n, t),
        (t = n.state.preload) &&
          (n.state.loading & 3) === 0 &&
          (e.count++, (n = Br.bind(e)), t.addEventListener("load", n), t.addEventListener("error", n)));
    }
  }
  var ku = 0;
  function H0(e, t) {
    return (
      e.stylesheets && e.count === 0 && hr(e, e.stylesheets),
      0 < e.count || 0 < e.imgCount
        ? function (n) {
            var i = setTimeout(function () {
              if ((e.stylesheets && hr(e, e.stylesheets), e.unsuspend)) {
                var l = e.unsuspend;
                ((e.unsuspend = null), l());
              }
            }, 6e4 + t);
            0 < e.imgBytes && ku === 0 && (ku = 62500 * _0());
            var a = setTimeout(
              function () {
                if (
                  ((e.waitingForImages = !1), e.count === 0 && (e.stylesheets && hr(e, e.stylesheets), e.unsuspend))
                ) {
                  var l = e.unsuspend;
                  ((e.unsuspend = null), l());
                }
              },
              (e.imgBytes > ku ? 50 : 800) + t,
            );
            return (
              (e.unsuspend = n),
              function () {
                ((e.unsuspend = null), clearTimeout(i), clearTimeout(a));
              }
            );
          }
        : null
    );
  }
  function Br() {
    if ((this.count--, this.count === 0 && (this.imgCount === 0 || !this.waitingForImages))) {
      if (this.stylesheets) hr(this, this.stylesheets);
      else if (this.unsuspend) {
        var e = this.unsuspend;
        ((this.unsuspend = null), e());
      }
    }
  }
  var Gr = null;
  function hr(e, t) {
    ((e.stylesheets = null),
      e.unsuspend !== null && (e.count++, (Gr = new Map()), t.forEach(B0, e), (Gr = null), Br.call(e)));
  }
  function B0(e, t) {
    if (!(t.state.loading & 4)) {
      var n = Gr.get(e);
      if (n) var i = n.get(null);
      else {
        ((n = new Map()), Gr.set(e, n));
        for (var a = e.querySelectorAll("link[data-precedence],style[data-precedence]"), l = 0; l < a.length; l++) {
          var r = a[l];
          (r.nodeName === "LINK" || r.getAttribute("media") !== "not all") && (n.set(r.dataset.precedence, r), (i = r));
        }
        i && n.set(null, i);
      }
      ((a = t.instance),
        (r = a.getAttribute("data-precedence")),
        (l = n.get(r) || i),
        l === i && n.set(null, a),
        n.set(r, a),
        this.count++,
        (i = Br.bind(this)),
        a.addEventListener("load", i),
        a.addEventListener("error", i),
        l
          ? l.parentNode.insertBefore(a, l.nextSibling)
          : ((e = e.nodeType === 9 ? e.head : e), e.insertBefore(a, e.firstChild)),
        (t.state.loading |= 4));
    }
  }
  var sl = { $$typeof: Mt, Provider: null, Consumer: null, _currentValue: Bn, _currentValue2: Bn, _threadCount: 0 };
  function G0(e, t, n, i, a, l, r, s, u) {
    ((this.tag = 1),
      (this.containerInfo = e),
      (this.pingCache = this.current = this.pendingChildren = null),
      (this.timeoutHandle = -1),
      (this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null),
      (this.callbackPriority = 0),
      (this.expirationTimes = tu(-1)),
      (this.entangledLanes =
        this.shellSuspendCounter =
        this.errorRecoveryDisabledLanes =
        this.expiredLanes =
        this.warmLanes =
        this.pingedLanes =
        this.suspendedLanes =
        this.pendingLanes =
          0),
      (this.entanglements = tu(0)),
      (this.hiddenUpdates = tu(null)),
      (this.identifierPrefix = i),
      (this.onUncaughtError = a),
      (this.onCaughtError = l),
      (this.onRecoverableError = r),
      (this.pooledCache = null),
      (this.pooledCacheLanes = 0),
      (this.formState = u),
      (this.incompleteTransitions = new Map()));
  }
  function My(e, t, n, i, a, l, r, s, u, o, f, m) {
    return (
      (e = new G0(e, t, n, r, u, o, f, m, s)),
      (t = 1),
      l === !0 && (t |= 24),
      (l = Ke(3, null, null, t)),
      (e.current = l),
      (l.stateNode = e),
      (t = Yo()),
      t.refCount++,
      (e.pooledCache = t),
      t.refCount++,
      (l.memoizedState = { element: i, isDehydrated: n, cache: t }),
      Xo(l),
      e
    );
  }
  function qy(e) {
    return e ? ((e = zi), e) : zi;
  }
  function Ly(e, t, n, i, a, l) {
    ((a = qy(a)),
      i.context === null ? (i.context = a) : (i.pendingContext = a),
      (i = gn(t)),
      (i.payload = { element: n }),
      (l = l === void 0 ? null : l),
      l !== null && (i.callback = l),
      (n = yn(e, i, t)),
      n !== null && (qe(n, e, t), Ga(n, e, t)));
  }
  function Wd(e, t) {
    if (((e = e.memoizedState), e !== null && e.dehydrated !== null)) {
      var n = e.retryLane;
      e.retryLane = n !== 0 && n < t ? n : t;
    }
  }
  function pc(e, t) {
    (Wd(e, t), (e = e.alternate) && Wd(e, t));
  }
  function Hy(e) {
    if (e.tag === 13 || e.tag === 31) {
      var t = Pn(e, 67108864);
      (t !== null && qe(t, e, 67108864), pc(e, 67108864));
    }
  }
  function Fd(e) {
    if (e.tag === 13 || e.tag === 31) {
      var t = Qe();
      t = ko(t);
      var n = Pn(e, t);
      (n !== null && qe(n, e, t), pc(e, t));
    }
  }
  var Kr = !0;
  function K0(e, t, n, i) {
    var a = U.T;
    U.T = null;
    var l = B.p;
    try {
      ((B.p = 2), _c(e, t, n, i));
    } finally {
      ((B.p = l), (U.T = a));
    }
  }
  function Y0(e, t, n, i) {
    var a = U.T;
    U.T = null;
    var l = B.p;
    try {
      ((B.p = 8), _c(e, t, n, i));
    } finally {
      ((B.p = l), (U.T = a));
    }
  }
  function _c(e, t, n, i) {
    if (Kr) {
      var a = Ao(i);
      if (a === null) (Ou(e, t, i, Yr, n), Pd(e, i));
      else if (V0(a, e, t, n, i)) i.stopPropagation();
      else if ((Pd(e, i), t & 4 && -1 < I0.indexOf(e))) {
        for (; a !== null;) {
          var l = ia(a);
          if (l !== null)
            switch (l.tag) {
              case 3:
                if (((l = l.stateNode), l.current.memoizedState.isDehydrated)) {
                  var r = qn(l.pendingLanes);
                  if (r !== 0) {
                    var s = l;
                    for (s.pendingLanes |= 2, s.entangledLanes |= 2; r;) {
                      var u = 1 << (31 - Xe(r));
                      ((s.entanglements[1] |= u), (r &= ~u));
                    }
                    (Et(l), (H & 6) === 0 && ((Nr = Ie() + 500), _l(0, !1)));
                  }
                }
                break;
              case 31:
              case 13:
                ((s = Pn(l, 2)), s !== null && qe(s, l, 2), ns(), pc(l, 2));
            }
          if (((l = Ao(i)), l === null && Ou(e, t, i, Yr, n), l === a)) break;
          a = l;
        }
        a !== null && i.stopPropagation();
      } else Ou(e, t, i, null, n);
    }
  }
  function Ao(e) {
    return ((e = Do(e)), bc(e));
  }
  var Yr = null;
  function bc(e) {
    if (((Yr = null), (e = xi(e)), e !== null)) {
      var t = cl(e);
      if (t === null) e = null;
      else {
        var n = t.tag;
        if (n === 13) {
          if (((e = lh(t)), e !== null)) return e;
          e = null;
        } else if (n === 31) {
          if (((e = rh(t)), e !== null)) return e;
          e = null;
        } else if (n === 3) {
          if (t.stateNode.current.memoizedState.isDehydrated) return t.tag === 3 ? t.stateNode.containerInfo : null;
          e = null;
        } else t !== e && (e = null);
      }
    }
    return ((Yr = e), null);
  }
  function By(e) {
    switch (e) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (Uv()) {
          case ch:
            return 2;
          case fh:
            return 8;
          case pr:
          case Nv:
            return 32;
          case dh:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var Ro = !1,
    pn = null,
    _n = null,
    bn = null,
    ul = new Map(),
    ol = new Map(),
    rn = [],
    I0 =
      "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
        " ",
      );
  function Pd(e, t) {
    switch (e) {
      case "focusin":
      case "focusout":
        pn = null;
        break;
      case "dragenter":
      case "dragleave":
        _n = null;
        break;
      case "mouseover":
      case "mouseout":
        bn = null;
        break;
      case "pointerover":
      case "pointerout":
        ul.delete(t.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        ol.delete(t.pointerId);
    }
  }
  function Ca(e, t, n, i, a, l) {
    return e === null || e.nativeEvent !== l
      ? ((e = { blockedOn: t, domEventName: n, eventSystemFlags: i, nativeEvent: l, targetContainers: [a] }),
        t !== null && ((t = ia(t)), t !== null && Hy(t)),
        e)
      : ((e.eventSystemFlags |= i), (t = e.targetContainers), a !== null && t.indexOf(a) === -1 && t.push(a), e);
  }
  function V0(e, t, n, i, a) {
    switch (t) {
      case "focusin":
        return ((pn = Ca(pn, e, t, n, i, a)), !0);
      case "dragenter":
        return ((_n = Ca(_n, e, t, n, i, a)), !0);
      case "mouseover":
        return ((bn = Ca(bn, e, t, n, i, a)), !0);
      case "pointerover":
        var l = a.pointerId;
        return (ul.set(l, Ca(ul.get(l) || null, e, t, n, i, a)), !0);
      case "gotpointercapture":
        return ((l = a.pointerId), ol.set(l, Ca(ol.get(l) || null, e, t, n, i, a)), !0);
    }
    return !1;
  }
  function Gy(e) {
    var t = xi(e.target);
    if (t !== null) {
      var n = cl(t);
      if (n !== null) {
        if (((t = n.tag), t === 13)) {
          if (((t = lh(n)), t !== null)) {
            ((e.blockedOn = t),
              Mf(e.priority, function () {
                Fd(n);
              }));
            return;
          }
        } else if (t === 31) {
          if (((t = rh(n)), t !== null)) {
            ((e.blockedOn = t),
              Mf(e.priority, function () {
                Fd(n);
              }));
            return;
          }
        } else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
          e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
          return;
        }
      }
    }
    e.blockedOn = null;
  }
  function gr(e) {
    if (e.blockedOn !== null) return !1;
    for (var t = e.targetContainers; 0 < t.length;) {
      var n = Ao(e.nativeEvent);
      if (n === null) {
        n = e.nativeEvent;
        var i = new n.constructor(n.type, n);
        ((Ku = i), n.target.dispatchEvent(i), (Ku = null));
      } else return ((t = ia(n)), t !== null && Hy(t), (e.blockedOn = n), !1);
      t.shift();
    }
    return !0;
  }
  function eh(e, t, n) {
    gr(e) && n.delete(t);
  }
  function X0() {
    ((Ro = !1),
      pn !== null && gr(pn) && (pn = null),
      _n !== null && gr(_n) && (_n = null),
      bn !== null && gr(bn) && (bn = null),
      ul.forEach(eh),
      ol.forEach(eh));
  }
  function Fl(e, t) {
    e.blockedOn === t &&
      ((e.blockedOn = null), Ro || ((Ro = !0), ye.unstable_scheduleCallback(ye.unstable_NormalPriority, X0)));
  }
  var Pl = null;
  function th(e) {
    Pl !== e &&
      ((Pl = e),
      ye.unstable_scheduleCallback(ye.unstable_NormalPriority, function () {
        Pl === e && (Pl = null);
        for (var t = 0; t < e.length; t += 3) {
          var n = e[t],
            i = e[t + 1],
            a = e[t + 2];
          if (typeof i != "function") {
            if (bc(i || n) === null) continue;
            break;
          }
          var l = ia(n);
          l !== null && (e.splice(t, 3), (t -= 3), ao(l, { pending: !0, data: a, method: n.method, action: i }, i, a));
        }
      }));
  }
  function ta(e) {
    function t(u) {
      return Fl(u, e);
    }
    (pn !== null && Fl(pn, e), _n !== null && Fl(_n, e), bn !== null && Fl(bn, e), ul.forEach(t), ol.forEach(t));
    for (var n = 0; n < rn.length; n++) {
      var i = rn[n];
      i.blockedOn === e && (i.blockedOn = null);
    }
    for (; 0 < rn.length && ((n = rn[0]), n.blockedOn === null);) (Gy(n), n.blockedOn === null && rn.shift());
    if (((n = (e.ownerDocument || e).$$reactFormReplay), n != null))
      for (i = 0; i < n.length; i += 3) {
        var a = n[i],
          l = n[i + 1],
          r = a[Le] || null;
        if (typeof l == "function") r || th(n);
        else if (r) {
          var s = null;
          if (l && l.hasAttribute("formAction")) {
            if (((a = l), (r = l[Le] || null))) s = r.formAction;
            else if (bc(a) !== null) continue;
          } else s = r.action;
          (typeof s == "function" ? (n[i + 1] = s) : (n.splice(i, 3), (i -= 3)), th(n));
        }
      }
  }
  function Ky() {
    function e(l) {
      l.canIntercept &&
        l.info === "react-transition" &&
        l.intercept({
          handler: function () {
            return new Promise(function (r) {
              return (a = r);
            });
          },
          focusReset: "manual",
          scroll: "manual",
        });
    }
    function t() {
      (a !== null && (a(), (a = null)), i || setTimeout(n, 20));
    }
    function n() {
      if (!i && !navigation.transition) {
        var l = navigation.currentEntry;
        l &&
          l.url != null &&
          navigation.navigate(l.url, { state: l.getState(), info: "react-transition", history: "replace" });
      }
    }
    if (typeof navigation == "object") {
      var i = !1,
        a = null;
      return (
        navigation.addEventListener("navigate", e),
        navigation.addEventListener("navigatesuccess", t),
        navigation.addEventListener("navigateerror", t),
        setTimeout(n, 100),
        function () {
          ((i = !0),
            navigation.removeEventListener("navigate", e),
            navigation.removeEventListener("navigatesuccess", t),
            navigation.removeEventListener("navigateerror", t),
            a !== null && (a(), (a = null)));
        }
      );
    }
  }
  function wc(e) {
    this._internalRoot = e;
  }
  ls.prototype.render = wc.prototype.render = function (e) {
    var t = this._internalRoot;
    if (t === null) throw Error(p(409));
    var n = t.current,
      i = Qe();
    Ly(n, i, e, t, null, null);
  };
  ls.prototype.unmount = wc.prototype.unmount = function () {
    var e = this._internalRoot;
    if (e !== null) {
      this._internalRoot = null;
      var t = e.containerInfo;
      (Ly(e.current, 2, null, e, null, null), ns(), (t[na] = null));
    }
  };
  function ls(e) {
    this._internalRoot = e;
  }
  ls.prototype.unstable_scheduleHydration = function (e) {
    if (e) {
      var t = vh();
      e = { blockedOn: null, target: e, priority: t };
      for (var n = 0; n < rn.length && t !== 0 && t < rn[n].priority; n++);
      (rn.splice(n, 0, e), n === 0 && Gy(e));
    }
  };
  var nh = ih.version;
  if (nh !== "19.2.5") throw Error(p(527, nh, "19.2.5"));
  B.findDOMNode = function (e) {
    var t = e._reactInternals;
    if (t === void 0)
      throw typeof e.render == "function" ? Error(p(188)) : ((e = Object.keys(e).join(",")), Error(p(268, e)));
    return ((e = Av(t)), (e = e !== null ? sh(e) : null), (e = e === null ? null : e.stateNode), e);
  };
  var Q0 = {
    bundleType: 0,
    version: "19.2.5",
    rendererPackageName: "react-dom",
    currentDispatcherRef: U,
    reconcilerVersion: "19.2.5",
  };
  if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" &&
    ((Ua = __REACT_DEVTOOLS_GLOBAL_HOOK__), !Ua.isDisabled && Ua.supportsFiber)
  )
    try {
      ((fl = Ua.inject(Q0)), (Ve = Ua));
    } catch {}
  var Ua;
  rs.createRoot = function (e, t) {
    if (!ah(e)) throw Error(p(299));
    var n = !1,
      i = "",
      a = Dg,
      l = zg,
      r = jg;
    return (
      t != null &&
        (t.unstable_strictMode === !0 && (n = !0),
        t.identifierPrefix !== void 0 && (i = t.identifierPrefix),
        t.onUncaughtError !== void 0 && (a = t.onUncaughtError),
        t.onCaughtError !== void 0 && (l = t.onCaughtError),
        t.onRecoverableError !== void 0 && (r = t.onRecoverableError)),
      (t = My(e, 1, !1, null, null, n, i, null, a, l, r, Ky)),
      (e[na] = t.current),
      yc(e),
      new wc(t)
    );
  };
  rs.hydrateRoot = function (e, t, n) {
    if (!ah(e)) throw Error(p(299));
    var i = !1,
      a = "",
      l = Dg,
      r = zg,
      s = jg,
      u = null;
    return (
      n != null &&
        (n.unstable_strictMode === !0 && (i = !0),
        n.identifierPrefix !== void 0 && (a = n.identifierPrefix),
        n.onUncaughtError !== void 0 && (l = n.onUncaughtError),
        n.onCaughtError !== void 0 && (r = n.onCaughtError),
        n.onRecoverableError !== void 0 && (s = n.onRecoverableError),
        n.formState !== void 0 && (u = n.formState)),
      (t = My(e, 1, !0, t, n ?? null, i, a, u, l, r, s, Ky)),
      (t.context = qy(null)),
      (n = t.current),
      (i = Qe()),
      (i = ko(i)),
      (a = gn(i)),
      (a.callback = null),
      yn(n, a, i),
      (n = i),
      (t.current.lanes = n),
      hl(t, n),
      Et(t),
      (e[na] = t.current),
      yc(e),
      new ls(t)
    );
  };
  rs.version = "19.2.5";
});
var Xy = mt((M_, Vy) => {
  "use strict";
  function Iy() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Iy);
      } catch (e) {
        console.error(e);
      }
  }
  (Iy(), (Vy.exports = Yy()));
});
var am = mt((hs) => {
  "use strict";
  var W0 = Symbol.for("react.transitional.element"),
    F0 = Symbol.for("react.fragment");
  function im(e, t, n) {
    var i = null;
    if ((n !== void 0 && (i = "" + n), t.key !== void 0 && (i = "" + t.key), "key" in t)) {
      n = {};
      for (var a in t) a !== "key" && (n[a] = t[a]);
    } else n = t;
    return ((t = n.ref), { $$typeof: W0, type: e, key: i, ref: t !== void 0 ? t : null, props: n });
  }
  hs.Fragment = F0;
  hs.jsx = im;
  hs.jsxs = im;
});
var Sl = mt((X_, lm) => {
  "use strict";
  lm.exports = am();
});
var Im = mi(Xy(), 1);
var us = (e) => {
    if (!e || typeof e != "object" || Array.isArray(e)) throw new Error("Malformed control response");
    return e;
  },
  ti = (e, t = 256) => {
    if (typeof e != "string" || !e.length || e.length > t) throw new Error("Malformed control text");
    return e;
  },
  Jt = (e) => {
    if (typeof e != "boolean") throw new Error("Malformed control flag");
    return e;
  },
  On = (e) => {
    if (!Number.isSafeInteger(e) || e < 0) throw new Error("Malformed control counter");
    return e;
  },
  Sc = (e) => (e === null ? null : On(e)),
  ss = (e) => (e === void 0 ? null : Sc(e)),
  Qy = (e) => (e === null ? null : ti(e)),
  Ec = (e) => {
    if (!Array.isArray(e) || e.length > 100) throw new Error("Malformed control reasons");
    return e.map((t) => ti(t, 1e3));
  };
function Jy(e) {
  if (e !== "OFF" && e !== "PAUSE_ENTRIES") throw new Error("Unsupported desired mode");
  return e;
}
function Ac(e) {
  let t = us(e),
    n = us(t.readiness);
  if (
    t.contract_version !== 1 ||
    t.package_mode !== "OFFLINE_PREPARATION" ||
    t.accounting_scope !== "SYNTHETIC_FIXTURES_ONLY"
  )
    throw new Error("Unsupported control contract");
  if (typeof t.observed_mode != "string" || !["OFF", "PAUSE_ENTRIES", "UNKNOWN"].includes(t.observed_mode))
    throw new Error("Unsupported worker mode");
  let i = {
    contract_version: 1,
    accounting_scope: "SYNTHETIC_FIXTURES_ONLY",
    package_mode: "OFFLINE_PREPARATION",
    owner_authenticated: Jt(t.owner_authenticated),
    desired_mode: Jy(t.desired_mode),
    observed_mode: t.observed_mode,
    version: On(t.version),
    acknowledged_version: Sc(t.acknowledged_version),
    applied_command_id: Qy(t.applied_command_id),
    pending_command_id: Qy(t.pending_command_id),
    pending_ack: Jt(t.pending_ack),
    worker_epoch: On(t.worker_epoch),
    worker_stale: Jt(t.worker_stale),
    worker_heartbeat_at: Sc(t.worker_heartbeat_at),
    halted: Jt(t.halted),
    halt_generation: On(t.halt_generation),
    halt_reasons: Ec(t.halt_reasons),
    reconciliation_required: Jt(t.reconciliation_required),
    reconciliation_as_of: ss(t.reconciliation_as_of),
    pending_outcomes: ss(t.pending_outcomes),
    unknown_outcomes: ss(t.unknown_outcomes),
    residual_holdings_count: ss(t.residual_holdings_count),
    existing_exit_monitoring_active: Jt(t.existing_exit_monitoring_active),
    readiness: { ready: Jt(n.ready), blockers: Ec(n.blockers) },
    live_capable: Jt(t.live_capable),
    runtime_identity: ti(t.runtime_identity),
    policy_hash: ti(t.policy_hash),
    server_time: On(t.server_time),
  };
  if (i.acknowledged_version !== null && i.acknowledged_version > i.version)
    throw new Error("Impossible worker version");
  if (i.worker_heartbeat_at !== null && i.worker_heartbeat_at > i.server_time + 2)
    throw new Error("Future worker heartbeat");
  return i;
}
function Rc(e) {
  let t = us(e);
  if (t.contract_version !== 1 || t.acknowledged !== !1) throw new Error("A receipt is not worker acknowledgement");
  return {
    contract_version: 1,
    command_id: ti(t.command_id),
    accepted: Jt(t.accepted),
    code: ti(t.code),
    version: On(t.version),
    desired_mode: Jy(t.desired_mode),
    acknowledged: !1,
    created_at: On(t.created_at),
    blockers: Ec(t.blockers),
  };
}
function Tc(e) {
  let t = us(e);
  return { csrf_token: ti(t.csrf_token, 4096), expires_at: On(t.expires_at) };
}
var Cc = "app-session-jwt-age300-v1",
  P = class extends Error {
    constructor(n, i, a = null) {
      super("Owner request not confirmed: " + n);
      this.code = n;
      this.outcome = i;
      this.status = a;
    }
  },
  oa = () => {
    throw new P("INVALID_REQUEST", "not_sent");
  };
function Zy(e) {
  return !e || typeof e != "object" || Array.isArray(e) ? oa() : e;
}
function os(e, t) {
  Object.keys(e).sort().join(",") !== t.sort().join(",") && oa();
}
var ni = (e) => Number.isSafeInteger(e) && e >= 0,
  $y = (e) => typeof e == "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e),
  Oc = (e, t = 240) => typeof e == "string" && e.length > 0 && e.length <= t && !/[\u0000-\u001f\u007f]/.test(e),
  Wy = (e) => typeof e == "string" && /^[A-Za-z0-9_-]{1,240}$/.test(e);
function Fy(e) {
  let t = Zy(e),
    n = t.kind;
  if (n === "control-command") {
    os(t, ["kind", "command", "csrfToken"]);
    let r = Zy(t.command);
    if (
      (os(r, [
        "command_id",
        "expected_version",
        "action",
        "expires_at",
        "expected_runtime_identity",
        "expected_policy_hash",
        "reason",
      ]),
      !Wy(r.command_id) ||
        !ni(r.expected_version) ||
        !ni(r.expires_at) ||
        typeof r.action != "string" ||
        !["OFF", "PAUSE_ENTRIES"].includes(r.action) ||
        !Oc(r.expected_runtime_identity) ||
        !Oc(r.expected_policy_hash) ||
        !Oc(r.reason, 240) ||
        typeof t.csrfToken != "string" ||
        !/^[\x21-\x7e]{16,1024}$/.test(t.csrfToken))
    )
      return oa();
    let s = JSON.stringify(r);
    return s.length > 8192
      ? oa()
      : {
          kind: n,
          path: "/api/control/commands",
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": t.csrfToken },
          body: s,
          mutation: !0,
          requiresFreshJwt: !0,
        };
  }
  if (n === "control-receipt")
    return (
      os(t, ["kind", "commandId"]),
      Wy(t.commandId)
        ? {
            kind: n,
            path: "/api/control/commands/" + t.commandId,
            method: "GET",
            headers: {},
            mutation: !1,
            requiresFreshJwt: !0,
          }
        : oa()
    );
  os(t, ["kind"]);
  let i = {
    "session-evidence": "/api/owner-control/session-evidence",
    "enroll-current-session": "/api/owner-control/enroll",
    "revoke-current-session": "/api/owner-control/revoke",
    "control-session": "/api/control/session",
    "control-status": "/api/control/status",
  };
  if (typeof n != "string" || !Object.hasOwn(i, n)) return oa();
  let a = n,
    l = a === "enroll-current-session" ? "enroll" : a === "revoke-current-session" ? "revoke" : null;
  return {
    kind: a,
    path: i[a],
    method: l ? "POST" : "GET",
    headers: l ? { "Content-Type": "application/json", "X-Owner-Control-Action": l } : {},
    ...(l ? { body: "{}" } : {}),
    mutation: l !== null,
    requiresFreshJwt: a !== "revoke-current-session",
  };
}
function xc(e, t) {
  if (!e || typeof e != "object" || Array.isArray(e)) throw new Error("Response");
  let n = e;
  if (t && Object.keys(n).sort().join(",") !== t.sort().join(",")) throw new Error("Response");
  return n;
}
function kc(e, t) {
  return ni(e) && e <= t + 2 && e >= t - 10;
}
function Py(e, t, n) {
  try {
    if (
      !ni(n.nowSeconds) ||
      !$y(n.subject) ||
      !$y(n.sessionId) ||
      !ni(n.tokenIat) ||
      !ni(n.tokenExp) ||
      n.tokenIat > n.nowSeconds ||
      n.tokenExp <= n.nowSeconds ||
      n.tokenIat >= n.tokenExp
    )
      throw new Error("Context");
    let i;
    if (e === "session-evidence") {
      let a = xc(t, [
        "schema_version",
        "subject",
        "session_id",
        "active",
        "observed_at",
        "valid_until",
        "policy_revision",
        "aal",
        "token_iat",
        "token_exp",
      ]);
      if (
        a.schema_version !== 1 ||
        a.subject !== n.subject ||
        a.session_id !== n.sessionId ||
        a.active !== !0 ||
        !kc(a.observed_at, n.nowSeconds) ||
        !ni(a.valid_until) ||
        a.valid_until !== Math.min(n.tokenExp, n.tokenIat + 300) ||
        a.valid_until <= n.nowSeconds ||
        a.valid_until <= a.observed_at ||
        a.policy_revision !== Cc ||
        typeof a.aal != "string" ||
        !["aal1", "aal2"].includes(a.aal) ||
        a.token_iat !== n.tokenIat ||
        a.token_exp !== n.tokenExp
      )
        throw new Error("Evidence");
      i = a;
    } else if (e === "enroll-current-session" || e === "revoke-current-session") {
      let a = e === "enroll-current-session" ? "enrolled" : "revoked",
        l = xc(t, ["schema_version", a, "scope", "server_time"]);
      if (
        l.schema_version !== 1 ||
        l[a] !== !0 ||
        l.scope !== "current_provider_session" ||
        !kc(l.server_time, n.nowSeconds)
      )
        throw new Error("Receipt");
      i = l;
    } else if (e === "control-session") {
      let a = xc(t, ["csrf_token", "expires_at"]);
      if (
        ((i = Tc(a)),
        !/^[\x21-\x7e]{16,1024}$/.test(i.csrf_token) ||
          i.expires_at <= n.nowSeconds ||
          i.expires_at > Math.min(n.tokenExp, n.tokenIat + 300))
      )
        throw new Error("Session");
    } else if (e === "control-status") {
      if (((i = Ac(t)), !kc(i.server_time, n.nowSeconds) || i.live_capable !== !1)) throw new Error("Status");
    } else if (e === "control-receipt" || e === "control-command") i = Rc(t);
    else throw new Error("Kind");
    return Object.freeze(i);
  } catch {
    throw new P("INVALID_RESPONSE", "uncertain");
  }
}
var ca = "https://alevdzyisibxcvwoyrqb.supabase.co",
  ii = "/owner/auth/callback",
  tm = "/solana-paper",
  xn = "owner-login-flow-v2",
  kn = "owner-session-enrollment-v1",
  em = 900 * 1e3,
  J0 = {
    unavailable: "Session enrollment is not configured. Controls remain unavailable.",
    not_requested:
      "No enrollment has been confirmed for this session here. Only the server can verify the configured owner.",
    requesting: "Requesting enrollment of this signed-in session\u2026 This does not enable live trading.",
    checking: "Checking this session\u2019s enrollment without changing it\u2026",
    enrolled:
      "The server confirmed enrollment of this session only. This is not a control acknowledgement or live-trading activation.",
    unknown:
      "Session enrollment is unknown. No automatic retry was made. Check current sign-in, then check session enrollment before another request.",
    rejected:
      "Session enrollment was rejected. A revoked session cannot be reopened. Sign in with a new session if needed, then check its enrollment.",
  },
  Z0 = {
    unavailable: "Sign-in is unavailable right now. Please try again later.",
    ready: "Log in with your email.",
    sending: "Sending your sign-in link\u2026",
    check_email: "Check your email for a sign-in link. Open it in this browser on this device.",
    exchanging: "Checking your sign-in link\u2026",
    changed: "Your session changed. Checking your sign-in\u2026",
    waiting: "Checking your sign-in\u2026",
    signout_partial: "Sign-out could not be fully confirmed. Check again before leaving a shared device.",
    signing_out: "Signing out\u2026",
    checking: "Checking your sign-in\u2026",
    signed_out: "You\u2019re signed out.",
    signed_in: "You\u2019re signed in.",
    invalid_callback:
      "This link could not be used. Open your latest link in the browser where you requested it, or check your sign-in again.",
    uncertain: "We couldn\u2019t confirm your sign-in. Please check again.",
    error: "We couldn\u2019t send a sign-in link. Check your email address and try again.",
  };
function ds(e) {
  let t = new URL(e);
  if (t.protocol !== "https:" || e !== t.origin || t.username || t.password)
    throw new Error("Exact HTTPS origin required");
  return e;
}
function nm(e, t) {
  if (typeof e != "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(e))
    return !1;
  let n = Number(e.slice(0, 4)),
    i = Number(e.slice(5, 7)),
    a = Number(e.slice(8, 10));
  if (
    i < 1 ||
    i > 12 ||
    a < 1 ||
    a > new Date(Date.UTC(n, i, 0)).getUTCDate() ||
    Number(e.slice(11, 13)) > 23 ||
    Number(e.slice(14, 16)) > 59 ||
    Number(e.slice(17, 19)) > 59
  )
    return !1;
  let l = Date.parse(e);
  return Number.isFinite(l) && Number.isSafeInteger(t) && l > 0 && l <= t;
}
function cs(e) {
  return (
    e.length <= 254 && /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(e)
  );
}
function Cn(e) {
  return typeof e == "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(e);
}
function $0(e, t) {
  try {
    if (typeof e != "string" || e.length > 2048) return null;
    let n = new URL(e);
    if (n.origin !== ds(t) || n.pathname !== ii || n.hash || n.username || n.password) return null;
    let i = [...n.searchParams];
    if (i.length !== 2 || i.filter(([r]) => r === "code").length !== 1 || i.filter(([r]) => r === "flow").length !== 1)
      return null;
    let a = n.searchParams.get("code"),
      l = n.searchParams.get("flow");
    return /^[A-Za-z0-9_-]{16,512}$/.test(a) && Cn(l) ? { code: a, flowId: l } : null;
  } catch {
    return null;
  }
}
var fs = class {
  constructor(t, n, i = Date.now, a = 12e3) {
    this.auth = t;
    this.origin = n;
    this.now = i;
    this.timeoutMs = a;
    this.state = this.makeState("unavailable");
    try {
      if ((ds(n), t.available !== !0 || !Number.isFinite(a) || a <= 0)) return;
      ((this.configured = !0), (this.state = this.makeState("checking")));
    } catch {}
  }
  state;
  listeners = new Set();
  closed = !1;
  generation = 0;
  operation = null;
  pendingInvalidation = !1;
  journal = null;
  configured = !1;
  enrollmentPhase = "not_requested";
  enrollmentJournal = null;
  enrollmentRaw = null;
  cancelWait = null;
  verifiedIdentity = null;
  makeState(t, n = !1) {
    return Object.freeze({
      phase: t,
      emailVerified: n,
      email:
        t === "signed_in" && n && this.verifiedIdentity?.email && cs(this.verifiedIdentity.email)
          ? this.verifiedIdentity.email
          : null,
      ownerAccess: "unavailable",
      liveEnabled: !1,
      canRequestLink:
        this.configured &&
        !this.activeJournal() &&
        ![
          "sending",
          "exchanging",
          "checking",
          "waiting",
          "changed",
          "signing_out",
          "unavailable",
          "signed_in",
        ].includes(t),
      message: Z0[t],
      enrollment: Object.freeze({
        phase: this.auth.ownerApiAvailable === !0 ? this.enrollmentPhase : "unavailable",
        canEnroll:
          this.configured &&
          this.auth.ownerApiAvailable === !0 &&
          t === "signed_in" &&
          n &&
          this.enrollmentPhase === "not_requested",
        canCheck:
          this.configured &&
          this.auth.ownerApiAvailable === !0 &&
          t === "signed_in" &&
          n &&
          !["requesting", "checking"].includes(this.enrollmentPhase),
        message: J0[this.auth.ownerApiAvailable === !0 ? this.enrollmentPhase : "unavailable"],
      }),
    });
  }
  snapshot = () => this.state;
  subscribe = (t) => (
    this.listeners.add(t),
    () => {
      this.listeners.delete(t);
    }
  );
  emit(t, n = !1) {
    if (!this.closed) {
      (this.pendingInvalidation && t === "signed_in" && ((t = "changed"), (n = !1)),
        (this.state = this.makeState(t, n)));
      for (let i of this.listeners) i();
    }
  }
  readJournal(t) {
    let n = t.getItem(xn);
    if (n === null) return null;
    if (n.length > 512) throw new Error("Invalid flow record");
    let i = JSON.parse(n);
    if (
      !i ||
      typeof i != "object" ||
      Object.keys(i).sort().join(",") !== "expiresAt,flowId,phase,startedAt,version" ||
      i.version !== 2 ||
      !Cn(i.flowId) ||
      !["requested", "exchanging", "consumed", "uncertain", "cancelled"].includes(i.phase) ||
      !Number.isSafeInteger(i.startedAt) ||
      i.startedAt < 0 ||
      !Number.isSafeInteger(i.expiresAt) ||
      i.expiresAt !== i.startedAt + em
    )
      throw new Error("Invalid flow record");
    if (!Number.isSafeInteger(this.now()) || i.startedAt > this.now()) throw new Error("Invalid flow clock");
    return i;
  }
  activeJournal() {
    let t = this.now();
    return (
      this.journal !== null &&
      !["consumed", "cancelled"].includes(this.journal.phase) &&
      Number.isSafeInteger(t) &&
      t >= this.journal.startedAt &&
      t < this.journal.expiresAt
    );
  }
  writeJournal(t, n) {
    if ((t.setItem(xn, JSON.stringify(n)), t.getItem(xn) !== JSON.stringify(n))) throw new Error("Storage unavailable");
    this.journal = n;
  }
  mark(t, n) {
    this.journal && this.writeJournal(t, { ...this.journal, phase: n });
  }
  readEnrollment(t) {
    let n = t.getItem(kn);
    if (n === this.enrollmentRaw) return;
    if (n === null) {
      this.enrollmentRaw !== null && (this.enrollmentPhase = "unknown");
      return;
    }
    if (n.length > 512) throw new Error("Invalid enrollment record");
    let i = JSON.parse(n);
    if (
      !i ||
      typeof i != "object" ||
      Object.keys(i).sort().join(",") !== "operationId,phase,startedAt,version" ||
      i.version !== 1 ||
      !Cn(i.operationId) ||
      !["requested", "enrolled", "unknown", "rejected"].includes(i.phase) ||
      !Number.isSafeInteger(i.startedAt) ||
      i.startedAt < 0 ||
      !Number.isSafeInteger(this.now()) ||
      i.startedAt > this.now()
    )
      throw new Error("Invalid enrollment record");
    ((this.enrollmentJournal = i), (this.enrollmentRaw = n), (this.enrollmentPhase = "unknown"));
  }
  writeEnrollment(t, n) {
    let i = JSON.stringify(n);
    if ((t.setItem(kn, i), t.getItem(kn) !== i)) throw new Error("Enrollment storage unavailable");
    ((this.enrollmentJournal = n), (this.enrollmentRaw = i));
  }
  finishEnrollment(t, n) {
    if (((this.enrollmentPhase = n), this.enrollmentJournal))
      try {
        this.writeEnrollment(t, { ...this.enrollmentJournal, phase: n });
      } catch {
        this.enrollmentPhase = "unknown";
      }
  }
  invalidateEnrollment() {
    this.enrollmentPhase !== "not_requested" && (this.enrollmentPhase = "unknown");
  }
  run(t) {
    if (this.closed || !this.configured || this.operation) return this.operation ?? Promise.resolve();
    let n = ++this.generation;
    return (
      (this.operation = Promise.resolve()
        .then(() => {
          if (this.current(n) && (this.emit("waiting"), !!this.current(n)))
            return this.auth.transact(async (i) => {
              if (this.current(n)) {
                if (this.auth.ownerApiAvailable === !0)
                  try {
                    this.readEnrollment(i.store);
                  } catch {
                    ((this.enrollmentPhase = "unknown"), (this.enrollmentJournal = null));
                  }
                await t(n, i);
              }
            });
        })
        .catch(() => {
          this.current(n) && this.emit("unavailable");
        })
        .finally(() => {
          n === this.generation &&
            ((this.operation = null),
            this.pendingInvalidation &&
              ((this.pendingInvalidation = !1),
              this.invalidateEnrollment(),
              this.emit("changed"),
              this.checkCurrentSignIn()));
        })),
      this.operation
    );
  }
  current(t) {
    return !this.closed && t === this.generation;
  }
  bounded(t) {
    return new Promise((n, i) => {
      let a = setTimeout(() => i(new Error("Timed out")), this.timeoutMs),
        l = () => {
          (clearTimeout(a), i(new Error("Closed")));
        };
      ((this.cancelWait = l),
        t.then(n, i).finally(() => {
          (clearTimeout(a), this.cancelWait === l && (this.cancelWait = null));
        }));
    });
  }
  requestLink(t) {
    return this.run(async (n, i) => {
      let a = !1;
      try {
        if (((this.journal = this.readJournal(i.store)), this.activeJournal())) {
          this.emit(this.journal?.phase === "requested" ? "check_email" : "uncertain");
          return;
        }
        if (!cs(t.trim())) {
          this.emit("error");
          return;
        }
        let l = this.now();
        if (!Number.isSafeInteger(l) || l < 0) throw new Error("Clock");
        if (
          (this.writeJournal(i.store, {
            version: 2,
            flowId: i.newFlowId(),
            phase: "requested",
            startedAt: l,
            expiresAt: l + em,
          }),
          this.emit("sending"),
          !this.current(n))
        )
          return;
        ((a = !0),
          await this.bounded(i.sendLink(t.trim(), this.journal.flowId)),
          this.current(n) && this.emit("check_email"));
      } catch {
        if (!this.current(n)) return;
        if (!a) {
          ((this.configured = !1), this.emit("unavailable"));
          return;
        }
        try {
          (this.mark(i.store, "uncertain"), this.emit("uncertain"));
        } catch {
          ((this.configured = !1), this.emit("unavailable"));
        }
      }
    });
  }
  completeCallback(t, n) {
    let i = $0(t, this.origin);
    t = "";
    try {
      n.scrub();
    } catch {
      return ((this.configured = !1), this.emit("unavailable"), Promise.resolve());
    }
    return this.run(async (a, l) => {
      let r = !1;
      try {
        if (
          ((this.journal = this.readJournal(l.store)),
          !i || i.flowId !== this.journal?.flowId || !this.activeJournal() || this.journal?.phase !== "requested")
        ) {
          ((i = null), this.emit("invalid_callback"));
          return;
        }
        if ((this.mark(l.store, "exchanging"), this.emit("exchanging"), !this.current(a))) {
          i = null;
          return;
        }
        r = !0;
        let s = l.exchangeCode(i.code, i.flowId);
        if (((i = null), await this.bounded(s), !this.current(a) || (this.mark(l.store, "consumed"), !this.current(a))))
          return;
        let u = await this.bounded(l.currentIdentity());
        if (!this.current(a)) return;
        this.pendingInvalidation || this.emitIdentity(u);
      } catch {
        if (((i = null), !this.current(a))) return;
        if (!r) {
          ((this.configured = !1), this.emit("unavailable"));
          return;
        }
        try {
          (this.mark(l.store, "uncertain"), this.emit("uncertain"));
        } catch {
          ((this.configured = !1), this.emit("unavailable"));
        }
      }
    });
  }
  checkCurrentSignIn() {
    return this.run(async (t, n) => {
      if (((this.journal = this.readJournal(n.store)), this.emit("checking"), !!this.current(t)))
        try {
          let i = await this.bounded(n.currentIdentity());
          this.current(t) &&
            !this.pendingInvalidation &&
            (i.kind === "signed_out" && this.activeJournal() && this.journal?.phase === "requested"
              ? this.emit("check_email")
              : this.emitIdentity(i));
        } catch {
          this.current(t) && this.emit("uncertain");
        }
    });
  }
  enrollCurrentSession() {
    return this.operation
      ? this.operation
      : this.state.enrollment.canEnroll
        ? this.run(async (t, n) => {
            if (this.enrollmentPhase !== "not_requested" || !n.ownerRequest || this.pendingInvalidation) {
              this.emit("changed");
              return;
            }
            let i = null;
            try {
              ((this.enrollmentPhase = "requesting"), this.emit("checking"));
              let a = await this.bounded(n.currentIdentity());
              if (!this.current(t) || this.pendingInvalidation) return;
              if (a.kind !== "signed_in" || a.emailVerified !== !0) {
                ((this.enrollmentPhase = "rejected"), this.emitIdentity(a, !0));
                return;
              }
              ((i = a), (this.verifiedIdentity = a));
              let l = this.now();
              if (!Number.isSafeInteger(l) || l < 0) throw new Error("Clock");
              if (
                (this.writeEnrollment(n.store, {
                  version: 1,
                  operationId: n.newFlowId(),
                  phase: "requested",
                  startedAt: l,
                }),
                this.emit("checking", !0),
                !this.current(t) ||
                  this.pendingInvalidation ||
                  (await this.bounded(n.ownerRequest({ kind: "enroll-current-session" })), !this.current(t)))
              )
                return;
              (this.finishEnrollment(n.store, this.pendingInvalidation ? "unknown" : "enrolled"),
                this.emit("signed_in", !0));
            } catch (a) {
              if (!this.current(t)) return;
              let l = a instanceof P && a.outcome !== "uncertain";
              (this.finishEnrollment(n.store, l ? "rejected" : "unknown"),
                i && !this.pendingInvalidation ? this.emitIdentity(i, !0) : this.emit("uncertain"));
            }
          })
        : Promise.resolve();
  }
  checkSessionEnrollment() {
    return this.operation
      ? this.operation
      : this.state.enrollment.canCheck
        ? this.run(async (t, n) => {
            if (!n.ownerRequest || this.pendingInvalidation) {
              this.emit("changed");
              return;
            }
            let i = !1;
            try {
              ((this.enrollmentPhase = "checking"), this.emit("checking"));
              let a = await this.bounded(n.currentIdentity());
              if (!this.current(t) || this.pendingInvalidation) return;
              if (a.kind !== "signed_in" || a.emailVerified !== !0) {
                ((this.enrollmentPhase = "unknown"), this.emitIdentity(a, !0));
                return;
              }
              if (
                ((i = !0),
                (this.verifiedIdentity = a),
                await this.bounded(n.ownerRequest({ kind: "session-evidence" })),
                !this.current(t))
              )
                return;
              (this.finishEnrollment(n.store, this.pendingInvalidation ? "unknown" : "enrolled"),
                this.emit("signed_in", !0));
            } catch (a) {
              if (!this.current(t)) return;
              (a instanceof P && a.outcome !== "uncertain" && a.code === "APP_SESSION_ENROLL_REQUIRED"
                ? (this.enrollmentPhase = "not_requested")
                : this.finishEnrollment(n.store, a instanceof P && a.outcome === "rejected" ? "rejected" : "unknown"),
                this.emit(i ? "signed_in" : "uncertain", i));
            }
          })
        : Promise.resolve();
  }
  initialize() {
    return this.run(async (t, n) => {
      ((this.journal = this.readJournal(n.store)),
        this.emit(
          this.activeJournal() ? (this.journal?.phase === "requested" ? "check_email" : "uncertain") : "ready",
        ));
    });
  }
  signOut() {
    return (
      this.invalidateEnrollment(),
      this.run(async (t, n) => {
        if (
          ((this.journal = this.readJournal(n.store)),
          this.mark(n.store, "cancelled"),
          this.emit("signing_out"),
          !!this.current(t))
        )
          try {
            let i = n.signOutWithRevocation
              ? await this.bounded(n.signOutWithRevocation())
              : (await this.bounded(n.signOut()), null);
            this.current(t) &&
              this.emit(
                i?.appRevocation === "not_configured" && i.providerSignOut !== "confirmed"
                  ? "uncertain"
                  : i &&
                      (i.providerSignOut !== "confirmed" || !["confirmed", "not_configured"].includes(i.appRevocation))
                    ? "signout_partial"
                    : "signed_out",
              );
          } catch {
            this.current(t) && this.emit("uncertain");
          }
      })
    );
  }
  emitIdentity(t, n = !1) {
    (n || this.invalidateEnrollment(),
      (this.verifiedIdentity = t.kind === "signed_in" ? t : null),
      t.kind === "signed_in" && typeof t.emailVerified == "boolean"
        ? this.emit("signed_in", t.emailVerified)
        : t.kind === "signed_out"
          ? this.emit("signed_out")
          : this.emit("uncertain"));
  }
  notifySessionChanged() {
    !this.configured ||
      this.closed ||
      (this.invalidateEnrollment(),
      (this.verifiedIdentity = null),
      this.emit("changed"),
      this.operation ? (this.pendingInvalidation = !0) : this.checkCurrentSignIn());
  }
  close() {
    ((this.closed = !0), this.generation++, this.cancelWait?.());
    try {
      this.auth.close?.();
    } catch {}
    this.listeners.clear();
  }
};
var gs = mi(zl(), 1);
var ee = mi(Sl(), 1);
function P0({ state: e, requestLink: t, checkCurrentSignIn: n, signOut: i }) {
  let [a, l] = (0, gs.useState)(""),
    r = ["sending", "checking", "exchanging", "waiting", "changed", "signing_out"].includes(e.phase),
    s = e.phase === "signed_in",
    u = ["uncertain", "signout_partial", "invalid_callback", "error"].includes(e.phase);
  return (0, ee.jsxs)("section", {
    "aria-labelledby": "owner-login-title",
    style: {
      maxWidth: "26rem",
      margin: "4rem auto",
      padding: "1.5rem",
      fontFamily: "system-ui, sans-serif",
      lineHeight: 1.5,
    },
    children: [
      (0, ee.jsx)("h1", {
        id: "owner-login-title",
        children: s
          ? "You\u2019re signed in"
          : e.phase === "check_email"
            ? "Check your email"
            : "Log in with your email",
      }),
      (0, ee.jsx)("p", {
        role: "status",
        "aria-live": "polite",
        children:
          s && e.email
            ? (0, ee.jsxs)(ee.Fragment, {
                children: [
                  "Signed in as ",
                  (0, ee.jsx)("strong", { children: e.email }),
                  " ",
                  (0, ee.jsx)("span", { children: "\xB7 Verified" }),
                ],
              })
            : e.message,
      }),
      s && !e.email && (0, ee.jsx)("p", { children: "Your email address could not be verified." }),
      !s &&
        e.phase !== "check_email" &&
        (0, ee.jsxs)("form", {
          onSubmit: (o) => {
            (o.preventDefault(), e.canRequestLink && !r && (t(a), l("")));
          },
          children: [
            (0, ee.jsx)("label", { htmlFor: "owner-login-email", children: "Email" }),
            (0, ee.jsx)("input", {
              id: "owner-login-email",
              type: "email",
              autoComplete: "email",
              maxLength: 254,
              required: !0,
              disabled: !e.canRequestLink || r,
              value: a,
              onChange: (o) => l(o.target.value),
              style: {
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                margin: "0.5rem 0 1rem",
                padding: "0.75rem",
                borderRadius: "0.4rem",
                border: "1px solid #64748b",
              },
            }),
            (0, ee.jsx)("button", {
              type: "submit",
              disabled: !e.canRequestLink || r,
              style: { padding: "0.75rem 1rem" },
              children: "Send sign-in link",
            }),
          ],
        }),
      e.phase === "check_email" &&
        (0, ee.jsx)("p", {
          children: "A new tab is fine. This browser remembers your sign-in, but sessions can expire or be revoked.",
        }),
      (u || e.phase === "check_email") &&
        (0, ee.jsx)("p", {
          children: (0, ee.jsx)("button", { type: "button", disabled: r, onClick: n, children: "Check sign-in again" }),
        }),
      (0, ee.jsxs)("p", {
        children: [
          (0, ee.jsx)("a", { href: tm, children: "Back to dashboard" }),
          s &&
            (0, ee.jsxs)(ee.Fragment, {
              children: [" ", "\xB7", " ", (0, ee.jsx)("button", { type: "button", onClick: i, children: "Sign out" })],
            }),
        ],
      }),
    ],
  });
}
function rm({ controller: e }) {
  let t = (0, gs.useSyncExternalStore)(e.subscribe, e.snapshot, e.snapshot);
  return (0, ee.jsx)(P0, {
    state: t,
    requestLink: (n) => {
      e.requestLink(n);
    },
    signOut: () => {
      e.signOut();
    },
    checkCurrentSignIn: () => {
      e.checkCurrentSignIn();
    },
  });
}
var e_ = new URL(ca).hostname.split(".")[0];
function sm(e) {
  if (typeof e != "string" || e.length > 4096) return !1;
  if (/^sb_publishable_[A-Za-z0-9_-]{12,512}$/.test(e)) return !0;
  let t = e.split(".");
  if (t.length !== 3 || !t.every((l) => l.length > 0 && /^[A-Za-z0-9_-]+$/.test(l)) || t[2].length !== 43) return !1;
  let n = (l, r) => {
      if (l.length > 2048) return null;
      try {
        let s = atob(l.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (l.length % 4)) % 4));
        if (s.length > 1024 || /[^\x20-\x7e]/.test(s) || s.includes("\\")) return null;
        let u = JSON.parse(s);
        if (!u || typeof u != "object" || Array.isArray(u)) return null;
        let o = u;
        return Object.keys(o).sort().join(",") !== [...r].sort().join(",") ||
          !r.every((f) => [...s.matchAll(new RegExp('"' + f + '"\\s*:', "g"))].length === 1)
          ? null
          : o;
      } catch {
        return null;
      }
    },
    i = n(t[0], ["alg", "typ"]),
    a = n(t[1], ["iss", "ref", "role", "iat", "exp"]);
  return (
    !!i &&
    !!a &&
    i.alg === "HS256" &&
    i.typ === "JWT" &&
    a.iss === "supabase" &&
    a.ref === e_ &&
    a.role === "anon" &&
    Number.isSafeInteger(a.iat) &&
    a.iat >= 0 &&
    Number.isSafeInteger(a.exp) &&
    a.exp > a.iat
  );
}
function ai(e, t) {
  var n = {};
  for (var i in e) Object.prototype.hasOwnProperty.call(e, i) && t.indexOf(i) < 0 && (n[i] = e[i]);
  if (e != null && typeof Object.getOwnPropertySymbols == "function")
    for (var a = 0, i = Object.getOwnPropertySymbols(e); a < i.length; a++)
      t.indexOf(i[a]) < 0 && Object.prototype.propertyIsEnumerable.call(e, i[a]) && (n[i[a]] = e[i[a]]);
  return n;
}
var ys = "2.108.2";
var At = 30 * 1e3,
  fa = 3,
  ms = fa * At,
  um = 2 * At,
  om = "http://localhost:9999",
  cm = "supabase.auth.token";
var fm = { "X-Client-Info": `gotrue-js/${ys}` };
var El = "X-Supabase-Api-Version",
  Uc = { "2024-01-01": { timestamp: Date.parse("2024-01-01T00:00:00.0Z"), name: "2024-01-01" } },
  dm = /^([a-z0-9_-]{4})*($|[a-z0-9_-]{3}$|[a-z0-9_-]{2}$)$/i,
  hm = 600 * 1e3;
var Un = class extends Error {
  constructor(t, n, i) {
    (super(t), (this.__isAuthError = !0), (this.name = "AuthError"), (this.status = n), (this.code = i));
  }
  toJSON() {
    return { name: this.name, message: this.message, status: this.status, code: this.code };
  }
};
function S(e) {
  return typeof e == "object" && e !== null && "__isAuthError" in e;
}
var vs = class extends Un {
  constructor(t, n, i) {
    (super(t, n, i), (this.name = "AuthApiError"), (this.status = n), (this.code = i));
  }
};
function gm(e) {
  return S(e) && e.name === "AuthApiError";
}
var Oe = class extends Un {
    constructor(t, n) {
      (super(t), (this.name = "AuthUnknownError"), (this.originalError = n));
    }
  },
  ot = class extends Un {
    constructor(t, n, i, a) {
      (super(t, i, a), (this.name = n), (this.status = i));
    }
  },
  le = class extends ot {
    constructor() {
      super("Auth session missing!", "AuthSessionMissingError", 400, void 0);
    }
  };
function si(e) {
  return S(e) && e.name === "AuthSessionMissingError";
}
var Zt = class extends ot {
    constructor() {
      super("Auth session or user missing", "AuthInvalidTokenResponseError", 500, void 0);
    }
  },
  li = class extends ot {
    constructor(t) {
      super(t, "AuthInvalidCredentialsError", 400, void 0);
    }
  },
  ri = class extends ot {
    constructor(t, n = null) {
      (super(t, "AuthImplicitGrantRedirectError", 500, void 0), (this.details = null), (this.details = n));
    }
    toJSON() {
      return Object.assign(Object.assign({}, super.toJSON()), { details: this.details });
    }
  };
function ym(e) {
  return S(e) && e.name === "AuthImplicitGrantRedirectError";
}
var Al = class extends ot {
    constructor(t, n = null) {
      (super(t, "AuthPKCEGrantCodeExchangeError", 500, void 0), (this.details = null), (this.details = n));
    }
    toJSON() {
      return Object.assign(Object.assign({}, super.toJSON()), { details: this.details });
    }
  },
  ps = class extends ot {
    constructor() {
      super(
        "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr on both the server and client to store the code verifier in cookies.",
        "AuthPKCECodeVerifierMissingError",
        400,
        "pkce_code_verifier_not_found",
      );
    }
  };
var da = class extends ot {
  constructor(t, n) {
    super(t, "AuthRetryableFetchError", n, void 0);
  }
};
function Nc(e) {
  return S(e) && e.name === "AuthRetryableFetchError";
}
var Rl = class extends ot {
  constructor(t = "Refresh result discarded: session state changed mid-flight (e.g., concurrent signOut)") {
    super(t, "AuthRefreshDiscardedError", 409, void 0);
  }
};
function mm(e) {
  return S(e) && e.name === "AuthRefreshDiscardedError";
}
var Tl = class extends ot {
  constructor(t, n, i) {
    (super(t, "AuthWeakPasswordError", n, "weak_password"), (this.reasons = i));
  }
  toJSON() {
    return Object.assign(Object.assign({}, super.toJSON()), { reasons: this.reasons });
  }
};
var Nn = class extends ot {
  constructor(t) {
    super(t, "AuthInvalidJwtError", 400, "invalid_jwt");
  }
};
var _s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split(""),
  vm = ` 	
\r=`.split(""),
  t_ = (() => {
    let e = new Array(128);
    for (let t = 0; t < e.length; t += 1) e[t] = -1;
    for (let t = 0; t < vm.length; t += 1) e[vm[t].charCodeAt(0)] = -2;
    for (let t = 0; t < _s.length; t += 1) e[_s[t].charCodeAt(0)] = t;
    return e;
  })();
function pm(e, t, n) {
  if (e !== null)
    for (t.queue = (t.queue << 8) | e, t.queuedBits += 8; t.queuedBits >= 6;) {
      let i = (t.queue >> (t.queuedBits - 6)) & 63;
      (n(_s[i]), (t.queuedBits -= 6));
    }
  else if (t.queuedBits > 0)
    for (t.queue = t.queue << (6 - t.queuedBits), t.queuedBits = 6; t.queuedBits >= 6;) {
      let i = (t.queue >> (t.queuedBits - 6)) & 63;
      (n(_s[i]), (t.queuedBits -= 6));
    }
}
function _m(e, t, n) {
  let i = t_[e];
  if (i > -1)
    for (t.queue = (t.queue << 6) | i, t.queuedBits += 6; t.queuedBits >= 8;)
      (n((t.queue >> (t.queuedBits - 8)) & 255), (t.queuedBits -= 8));
  else {
    if (i === -2) return;
    throw new Error(`Invalid Base64-URL character "${String.fromCharCode(e)}"`);
  }
}
function Dc(e) {
  let t = [],
    n = (r) => {
      t.push(String.fromCodePoint(r));
    },
    i = { utf8seq: 0, codepoint: 0 },
    a = { queue: 0, queuedBits: 0 },
    l = (r) => {
      a_(r, i, n);
    };
  for (let r = 0; r < e.length; r += 1) _m(e.charCodeAt(r), a, l);
  return t.join("");
}
function n_(e, t) {
  if (e <= 127) {
    t(e);
    return;
  } else if (e <= 2047) {
    (t(192 | (e >> 6)), t(128 | (e & 63)));
    return;
  } else if (e <= 65535) {
    (t(224 | (e >> 12)), t(128 | ((e >> 6) & 63)), t(128 | (e & 63)));
    return;
  } else if (e <= 1114111) {
    (t(240 | (e >> 18)), t(128 | ((e >> 12) & 63)), t(128 | ((e >> 6) & 63)), t(128 | (e & 63)));
    return;
  }
  throw new Error(`Unrecognized Unicode codepoint: ${e.toString(16)}`);
}
function i_(e, t) {
  for (let n = 0; n < e.length; n += 1) {
    let i = e.charCodeAt(n);
    if (i > 55295 && i <= 56319) {
      let a = ((i - 55296) * 1024) & 65535;
      ((i = (((e.charCodeAt(n + 1) - 56320) & 65535) | a) + 65536), (n += 1));
    }
    n_(i, t);
  }
}
function a_(e, t, n) {
  if (t.utf8seq === 0) {
    if (e <= 127) {
      n(e);
      return;
    }
    for (let i = 1; i < 6; i += 1)
      if (((e >> (7 - i)) & 1) === 0) {
        t.utf8seq = i;
        break;
      }
    if (t.utf8seq === 2) t.codepoint = e & 31;
    else if (t.utf8seq === 3) t.codepoint = e & 15;
    else if (t.utf8seq === 4) t.codepoint = e & 7;
    else throw new Error("Invalid UTF-8 sequence");
    t.utf8seq -= 1;
  } else if (t.utf8seq > 0) {
    if (e <= 127) throw new Error("Invalid UTF-8 sequence");
    ((t.codepoint = (t.codepoint << 6) | (e & 63)), (t.utf8seq -= 1), t.utf8seq === 0 && n(t.codepoint));
  }
}
function Dn(e) {
  let t = [],
    n = { queue: 0, queuedBits: 0 },
    i = (a) => {
      t.push(a);
    };
  for (let a = 0; a < e.length; a += 1) _m(e.charCodeAt(a), n, i);
  return new Uint8Array(t);
}
function bm(e) {
  let t = [];
  return (i_(e, (n) => t.push(n)), new Uint8Array(t));
}
function $t(e) {
  let t = [],
    n = { queue: 0, queuedBits: 0 },
    i = (a) => {
      t.push(a);
    };
  return (e.forEach((a) => pm(a, n, i)), pm(null, n, i), t.join(""));
}
function wm(e) {
  return Math.round(Date.now() / 1e3) + e;
}
function Sm() {
  return Symbol("auth-callback");
}
var _e = () => typeof window < "u" && typeof document < "u",
  ui = { tested: !1, writable: !1 },
  bs = () => {
    if (!_e()) return !1;
    try {
      if (typeof globalThis.localStorage != "object") return !1;
    } catch {
      return !1;
    }
    if (ui.tested) return ui.writable;
    let e = `lswt-${Math.random()}${Math.random()}`;
    try {
      (globalThis.localStorage.setItem(e, e),
        globalThis.localStorage.removeItem(e),
        (ui.tested = !0),
        (ui.writable = !0));
    } catch {
      ((ui.tested = !0), (ui.writable = !1));
    }
    return ui.writable;
  };
function Em(e) {
  let t = {},
    n = new URL(e);
  if (n.hash && n.hash[0] === "#")
    try {
      new URLSearchParams(n.hash.substring(1)).forEach((a, l) => {
        t[l] = a;
      });
    } catch {}
  return (
    n.searchParams.forEach((i, a) => {
      t[a] = i;
    }),
    t
  );
}
var ws = (e) => (e ? (...t) => e(...t) : (...t) => fetch(...t)),
  Am = (e) =>
    typeof e == "object" && e !== null && "status" in e && "ok" in e && "json" in e && typeof e.json == "function",
  oi = async (e, t, n) => {
    await e.setItem(t, JSON.stringify(n));
  },
  ct = async (e, t) => {
    let n = await e.getItem(t);
    if (!n) return null;
    try {
      return JSON.parse(n);
    } catch {
      return null;
    }
  },
  re = async (e, t) => {
    await e.removeItem(t);
  },
  Ol = class e {
    constructor() {
      this.promise = new e.promiseConstructor((t, n) => {
        ((this.resolve = t), (this.reject = n));
      });
    }
  };
Ol.promiseConstructor = Promise;
function xl(e) {
  let t = e.split(".");
  if (t.length !== 3) throw new Nn("Invalid JWT structure");
  for (let i = 0; i < t.length; i++) if (!dm.test(t[i])) throw new Nn("JWT not in base64url format");
  return {
    header: JSON.parse(Dc(t[0])),
    payload: JSON.parse(Dc(t[1])),
    signature: Dn(t[2]),
    raw: { header: t[0], payload: t[1] },
  };
}
async function Rm(e) {
  return await new Promise((t) => {
    setTimeout(() => t(null), e);
  });
}
function Tm(e, t) {
  return new Promise((i, a) => {
    (async () => {
      for (let l = 0; l < 1 / 0; l++)
        try {
          let r = await e(l);
          if (!t(l, null, r)) {
            i(r);
            return;
          }
        } catch (r) {
          if (!t(l, r)) {
            a(r);
            return;
          }
        }
    })();
  });
}
function l_(e) {
  return ("0" + e.toString(16)).substr(-2);
}
function r_() {
  let t = new Uint32Array(56);
  if (typeof crypto > "u") {
    let n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~",
      i = n.length,
      a = "";
    for (let l = 0; l < 56; l++) a += n.charAt(Math.floor(Math.random() * i));
    return a;
  }
  return (crypto.getRandomValues(t), Array.from(t, l_).join(""));
}
async function s_(e) {
  let n = new TextEncoder().encode(e),
    i = await crypto.subtle.digest("SHA-256", n),
    a = new Uint8Array(i);
  return Array.from(a)
    .map((l) => String.fromCharCode(l))
    .join("");
}
async function u_(e) {
  if (!(typeof crypto < "u" && typeof crypto.subtle < "u" && typeof TextEncoder < "u"))
    return (
      console.warn(
        "WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256.",
      ),
      e
    );
  let n = await s_(e);
  return btoa(n).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function zn(e, t, n = !1) {
  let i = r_(),
    a = i;
  (n && (a += "/recovery"), await oi(e, `${t}-code-verifier`, a));
  let l = await u_(i);
  return [l, i === l ? "plain" : "s256"];
}
var o_ = /^2[0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[0-1])$/i;
function Om(e) {
  let t = e.headers.get(El);
  if (!t || !t.match(o_)) return null;
  try {
    return new Date(`${t}T00:00:00.0Z`);
  } catch {
    return null;
  }
}
function xm(e) {
  if (!e) throw new Error("Missing exp claim");
  let t = Math.floor(Date.now() / 1e3);
  if (e <= t) throw new Error("JWT has expired");
}
function km(e) {
  switch (e) {
    case "RS256":
      return { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } };
    case "ES256":
      return { name: "ECDSA", namedCurve: "P-256", hash: { name: "SHA-256" } };
    default:
      throw new Error("Invalid alg claim");
  }
}
var c_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function Rt(e) {
  if (!c_.test(e)) throw new Error("@supabase/auth-js: Expected parameter to be UUID but is not");
}
function $e(e) {
  if (!e.passkey)
    throw new Error(
      "@supabase/auth-js: the passkey API is experimental and disabled by default. Enable it by passing `auth: { experimental: { passkey: true } }` to createClient (or to the GoTrueClient constructor).",
    );
}
function Ss() {
  let e = {};
  return new Proxy(e, {
    get: (t, n) => {
      if (n === "__isUserNotAvailableProxy") return !0;
      if (typeof n == "symbol") {
        let i = n.toString();
        if (
          i === "Symbol(Symbol.toPrimitive)" ||
          i === "Symbol(Symbol.toStringTag)" ||
          i === "Symbol(util.inspect.custom)"
        )
          return;
      }
      throw new Error(
        `@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Accessing the "${n}" property of the session object is not supported. Please use getUser() instead.`,
      );
    },
    set: (t, n) => {
      throw new Error(
        `@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Setting the "${n}" property of the session object is not supported. Please use getUser() to fetch a user object you can manipulate.`,
      );
    },
    deleteProperty: (t, n) => {
      throw new Error(
        `@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Deleting the "${n}" property of the session object is not supported. Please use getUser() to fetch a user object you can manipulate.`,
      );
    },
  });
}
function Cm(e, t) {
  return new Proxy(e, {
    get: (n, i, a) => {
      if (i === "__isInsecureUserWarningProxy") return !0;
      if (typeof i == "symbol") {
        let l = i.toString();
        if (
          l === "Symbol(Symbol.toPrimitive)" ||
          l === "Symbol(Symbol.toStringTag)" ||
          l === "Symbol(util.inspect.custom)" ||
          l === "Symbol(nodejs.util.inspect.custom)"
        )
          return Reflect.get(n, i, a);
      }
      return (
        !t.value &&
          typeof i == "string" &&
          (console.warn(
            "Using the user object as returned from supabase.auth.getSession() or from some supabase.auth.onAuthStateChange() events could be insecure! This value comes directly from the storage medium (usually cookies on the server) and may not be authentic. Use supabase.auth.getUser() instead which authenticates the data by contacting the Supabase Auth server.",
          ),
          (t.value = !0)),
        Reflect.get(n, i, a)
      );
    },
  });
}
function zc(e) {
  return JSON.parse(JSON.stringify(e));
}
var ci = (e) => {
    if (typeof e == "object" && e !== null) {
      let t = e;
      if (typeof t.msg == "string") return t.msg;
      if (typeof t.message == "string") return t.message;
      if (typeof t.error_description == "string") return t.error_description;
      if (typeof t.error == "string") return t.error;
    }
    return JSON.stringify(e);
  },
  f_ = [500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530];
async function Um(e) {
  var t;
  if (!Am(e)) throw new da(ci(e), 0);
  if (f_.includes(e.status)) throw new da(ci(e), e.status);
  let n;
  try {
    n = await e.json();
  } catch (l) {
    throw new Oe(ci(l), l);
  }
  let i,
    a = Om(e);
  if (
    (a && a.getTime() >= Uc["2024-01-01"].timestamp && typeof n == "object" && n && typeof n.code == "string"
      ? (i = n.code)
      : typeof n == "object" && n && typeof n.error_code == "string" && (i = n.error_code),
    i)
  ) {
    if (i === "weak_password")
      throw new Tl(ci(n), e.status, ((t = n.weak_password) === null || t === void 0 ? void 0 : t.reasons) || []);
    if (i === "session_not_found") throw new le();
  } else if (
    typeof n == "object" &&
    n &&
    typeof n.weak_password == "object" &&
    n.weak_password &&
    Array.isArray(n.weak_password.reasons) &&
    n.weak_password.reasons.length &&
    n.weak_password.reasons.reduce((l, r) => l && typeof r == "string", !0)
  )
    throw new Tl(ci(n), e.status, n.weak_password.reasons);
  throw new vs(ci(n), e.status || 500, i);
}
var d_ = (e, t, n, i) => {
  let a = { method: e, headers: t?.headers || {} };
  return e === "GET"
    ? a
    : ((a.headers = Object.assign({ "Content-Type": "application/json;charset=UTF-8" }, t?.headers)),
      (a.body = JSON.stringify(i)),
      Object.assign(Object.assign({}, a), n));
};
async function R(e, t, n, i) {
  var a;
  let l = Object.assign({}, i?.headers);
  (l[El] || (l[El] = Uc["2024-01-01"].name), i?.jwt && (l.Authorization = `Bearer ${i.jwt}`));
  let r = (a = i?.query) !== null && a !== void 0 ? a : {};
  i?.redirectTo && (r.redirect_to = i.redirectTo);
  let s = Object.keys(r).length ? "?" + new URLSearchParams(r).toString() : "",
    u = await h_(e, t, n + s, { headers: l, noResolveJson: i?.noResolveJson }, {}, i?.body);
  return i?.xform ? i?.xform(u) : { data: Object.assign({}, u), error: null };
}
async function h_(e, t, n, i, a, l) {
  let r = d_(t, i, a, l),
    s;
  try {
    s = await e(n, Object.assign({}, r));
  } catch (u) {
    throw (console.error(u), new da(ci(u), 0));
  }
  if ((s.ok || (await Um(s)), i?.noResolveJson)) return s;
  try {
    return await s.json();
  } catch (u) {
    await Um(u);
  }
}
function We(e) {
  var t;
  let n = null;
  g_(e) && ((n = Object.assign({}, e)), e.expires_at || (n.expires_at = wm(e.expires_in)));
  let i = (t = e.user) !== null && t !== void 0 ? t : typeof e?.id == "string" ? e : null;
  return { data: { session: n, user: i }, error: null };
}
function jc(e) {
  let t = We(e);
  return (
    !t.error &&
      e.weak_password &&
      typeof e.weak_password == "object" &&
      Array.isArray(e.weak_password.reasons) &&
      e.weak_password.reasons.length &&
      e.weak_password.message &&
      typeof e.weak_password.message == "string" &&
      e.weak_password.reasons.reduce((n, i) => n && typeof i == "string", !0) &&
      (t.data.weak_password = e.weak_password),
    t
  );
}
function Tt(e) {
  var t;
  return { data: { user: (t = e.user) !== null && t !== void 0 ? t : e }, error: null };
}
function Nm(e) {
  return { data: e, error: null };
}
function Dm(e) {
  let { action_link: t, email_otp: n, hashed_token: i, redirect_to: a, verification_type: l } = e,
    r = ai(e, ["action_link", "email_otp", "hashed_token", "redirect_to", "verification_type"]),
    s = { action_link: t, email_otp: n, hashed_token: i, redirect_to: a, verification_type: l },
    u = Object.assign({}, r);
  return { data: { properties: s, user: u }, error: null };
}
function Mc(e) {
  return e;
}
function g_(e) {
  return !!e.access_token && !!e.refresh_token && !!e.expires_in;
}
var Es = ["global", "local", "others"];
var fi = class {
  constructor({ url: t = "", headers: n = {}, fetch: i, experimental: a }) {
    ((this.url = t),
      (this.headers = n),
      (this.fetch = ws(i)),
      (this.experimental = a ?? {}),
      (this.mfa = { listFactors: this._listFactors.bind(this), deleteFactor: this._deleteFactor.bind(this) }),
      (this.oauth = {
        listClients: this._listOAuthClients.bind(this),
        createClient: this._createOAuthClient.bind(this),
        getClient: this._getOAuthClient.bind(this),
        updateClient: this._updateOAuthClient.bind(this),
        deleteClient: this._deleteOAuthClient.bind(this),
        regenerateClientSecret: this._regenerateOAuthClientSecret.bind(this),
      }),
      (this.customProviders = {
        listProviders: this._listCustomProviders.bind(this),
        createProvider: this._createCustomProvider.bind(this),
        getProvider: this._getCustomProvider.bind(this),
        updateProvider: this._updateCustomProvider.bind(this),
        deleteProvider: this._deleteCustomProvider.bind(this),
      }),
      (this.passkey = {
        listPasskeys: this._adminListPasskeys.bind(this),
        deletePasskey: this._adminDeletePasskey.bind(this),
      }));
  }
  async signOut(t, n = Es[0]) {
    if (Es.indexOf(n) < 0) throw new Error(`@supabase/auth-js: Parameter scope must be one of ${Es.join(", ")}`);
    try {
      return (
        await R(this.fetch, "POST", `${this.url}/logout?scope=${n}`, {
          headers: this.headers,
          jwt: t,
          noResolveJson: !0,
        }),
        { data: null, error: null }
      );
    } catch (i) {
      if (S(i)) return { data: null, error: i };
      throw i;
    }
  }
  async inviteUserByEmail(t, n = {}) {
    try {
      return await R(this.fetch, "POST", `${this.url}/invite`, {
        body: { email: t, data: n.data },
        headers: this.headers,
        redirectTo: n.redirectTo,
        xform: Tt,
      });
    } catch (i) {
      if (S(i)) return { data: { user: null }, error: i };
      throw i;
    }
  }
  async generateLink(t) {
    try {
      let { options: n } = t,
        i = ai(t, ["options"]),
        a = Object.assign(Object.assign({}, i), n);
      return (
        "newEmail" in i && ((a.new_email = i?.newEmail), delete a.newEmail),
        await R(this.fetch, "POST", `${this.url}/admin/generate_link`, {
          body: a,
          headers: this.headers,
          xform: Dm,
          redirectTo: n?.redirectTo,
        })
      );
    } catch (n) {
      if (S(n)) return { data: { properties: null, user: null }, error: n };
      throw n;
    }
  }
  async createUser(t) {
    try {
      return await R(this.fetch, "POST", `${this.url}/admin/users`, { body: t, headers: this.headers, xform: Tt });
    } catch (n) {
      if (S(n)) return { data: { user: null }, error: n };
      throw n;
    }
  }
  async listUsers(t) {
    var n, i, a, l, r, s, u;
    try {
      let o = { nextPage: null, lastPage: 0, total: 0 },
        f = await R(this.fetch, "GET", `${this.url}/admin/users`, {
          headers: this.headers,
          noResolveJson: !0,
          query: {
            page:
              (i = (n = t?.page) === null || n === void 0 ? void 0 : n.toString()) !== null && i !== void 0 ? i : "",
            per_page:
              (l = (a = t?.perPage) === null || a === void 0 ? void 0 : a.toString()) !== null && l !== void 0 ? l : "",
          },
          xform: Mc,
        });
      if (f.error) throw f.error;
      let m = await f.json(),
        d = (r = f.headers.get("x-total-count")) !== null && r !== void 0 ? r : 0,
        g =
          (u = (s = f.headers.get("link")) === null || s === void 0 ? void 0 : s.split(",")) !== null && u !== void 0
            ? u
            : [];
      return (
        g.length > 0 &&
          (g.forEach((_) => {
            let b = parseInt(_.split(";")[0].split("=")[1].substring(0, 1)),
              A = JSON.parse(_.split(";")[1].split("=")[1]);
            o[`${A}Page`] = b;
          }),
          (o.total = parseInt(d))),
        { data: Object.assign(Object.assign({}, m), o), error: null }
      );
    } catch (o) {
      if (S(o)) return { data: { users: [] }, error: o };
      throw o;
    }
  }
  async getUserById(t) {
    Rt(t);
    try {
      return await R(this.fetch, "GET", `${this.url}/admin/users/${t}`, { headers: this.headers, xform: Tt });
    } catch (n) {
      if (S(n)) return { data: { user: null }, error: n };
      throw n;
    }
  }
  async updateUserById(t, n) {
    Rt(t);
    try {
      return await R(this.fetch, "PUT", `${this.url}/admin/users/${t}`, { body: n, headers: this.headers, xform: Tt });
    } catch (i) {
      if (S(i)) return { data: { user: null }, error: i };
      throw i;
    }
  }
  async deleteUser(t, n = !1) {
    Rt(t);
    try {
      return await R(this.fetch, "DELETE", `${this.url}/admin/users/${t}`, {
        headers: this.headers,
        body: { should_soft_delete: n },
        xform: Tt,
      });
    } catch (i) {
      if (S(i)) return { data: { user: null }, error: i };
      throw i;
    }
  }
  async _listFactors(t) {
    Rt(t.userId);
    try {
      let { data: n, error: i } = await R(this.fetch, "GET", `${this.url}/admin/users/${t.userId}/factors`, {
        headers: this.headers,
        xform: (a) => ({ data: { factors: a }, error: null }),
      });
      return { data: n, error: i };
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _deleteFactor(t) {
    (Rt(t.userId), Rt(t.id));
    try {
      return {
        data: await R(this.fetch, "DELETE", `${this.url}/admin/users/${t.userId}/factors/${t.id}`, {
          headers: this.headers,
        }),
        error: null,
      };
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _listOAuthClients(t) {
    var n, i, a, l, r, s, u;
    try {
      let o = { nextPage: null, lastPage: 0, total: 0 },
        f = await R(this.fetch, "GET", `${this.url}/admin/oauth/clients`, {
          headers: this.headers,
          noResolveJson: !0,
          query: {
            page:
              (i = (n = t?.page) === null || n === void 0 ? void 0 : n.toString()) !== null && i !== void 0 ? i : "",
            per_page:
              (l = (a = t?.perPage) === null || a === void 0 ? void 0 : a.toString()) !== null && l !== void 0 ? l : "",
          },
          xform: Mc,
        });
      if (f.error) throw f.error;
      let m = await f.json(),
        d = (r = f.headers.get("x-total-count")) !== null && r !== void 0 ? r : 0,
        g =
          (u = (s = f.headers.get("link")) === null || s === void 0 ? void 0 : s.split(",")) !== null && u !== void 0
            ? u
            : [];
      return (
        g.length > 0 &&
          (g.forEach((_) => {
            let b = parseInt(_.split(";")[0].split("=")[1].substring(0, 1)),
              A = JSON.parse(_.split(";")[1].split("=")[1]);
            o[`${A}Page`] = b;
          }),
          (o.total = parseInt(d))),
        { data: Object.assign(Object.assign({}, m), o), error: null }
      );
    } catch (o) {
      if (S(o)) return { data: { clients: [] }, error: o };
      throw o;
    }
  }
  async _createOAuthClient(t) {
    try {
      return await R(this.fetch, "POST", `${this.url}/admin/oauth/clients`, {
        body: t,
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _getOAuthClient(t) {
    try {
      return await R(this.fetch, "GET", `${this.url}/admin/oauth/clients/${t}`, {
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _updateOAuthClient(t, n) {
    try {
      return await R(this.fetch, "PUT", `${this.url}/admin/oauth/clients/${t}`, {
        body: n,
        headers: this.headers,
        xform: (i) => ({ data: i, error: null }),
      });
    } catch (i) {
      if (S(i)) return { data: null, error: i };
      throw i;
    }
  }
  async _deleteOAuthClient(t) {
    try {
      return (
        await R(this.fetch, "DELETE", `${this.url}/admin/oauth/clients/${t}`, {
          headers: this.headers,
          noResolveJson: !0,
        }),
        { data: null, error: null }
      );
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _regenerateOAuthClientSecret(t) {
    try {
      return await R(this.fetch, "POST", `${this.url}/admin/oauth/clients/${t}/regenerate_secret`, {
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _listCustomProviders(t) {
    try {
      let n = {};
      return (
        t?.type && (n.type = t.type),
        await R(this.fetch, "GET", `${this.url}/admin/custom-providers`, {
          headers: this.headers,
          query: n,
          xform: (i) => {
            var a;
            return { data: { providers: (a = i?.providers) !== null && a !== void 0 ? a : [] }, error: null };
          },
        })
      );
    } catch (n) {
      if (S(n)) return { data: { providers: [] }, error: n };
      throw n;
    }
  }
  async _createCustomProvider(t) {
    try {
      return await R(this.fetch, "POST", `${this.url}/admin/custom-providers`, {
        body: t,
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _getCustomProvider(t) {
    try {
      return await R(this.fetch, "GET", `${this.url}/admin/custom-providers/${t}`, {
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _updateCustomProvider(t, n) {
    try {
      return await R(this.fetch, "PUT", `${this.url}/admin/custom-providers/${t}`, {
        body: n,
        headers: this.headers,
        xform: (i) => ({ data: i, error: null }),
      });
    } catch (i) {
      if (S(i)) return { data: null, error: i };
      throw i;
    }
  }
  async _deleteCustomProvider(t) {
    try {
      return (
        await R(this.fetch, "DELETE", `${this.url}/admin/custom-providers/${t}`, {
          headers: this.headers,
          noResolveJson: !0,
        }),
        { data: null, error: null }
      );
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _adminListPasskeys(t) {
    ($e(this.experimental), Rt(t.userId));
    try {
      return await R(this.fetch, "GET", `${this.url}/admin/users/${t.userId}/passkeys`, {
        headers: this.headers,
        xform: (n) => ({ data: n, error: null }),
      });
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
  async _adminDeletePasskey(t) {
    ($e(this.experimental), Rt(t.userId), Rt(t.passkeyId));
    try {
      return (
        await R(this.fetch, "DELETE", `${this.url}/admin/users/${t.userId}/passkeys/${t.passkeyId}`, {
          headers: this.headers,
          noResolveJson: !0,
        }),
        { data: null, error: null }
      );
    } catch (n) {
      if (S(n)) return { data: null, error: n };
      throw n;
    }
  }
};
function qc(e = {}) {
  return {
    getItem: (t) => e[t] || null,
    setItem: (t, n) => {
      e[t] = n;
    },
    removeItem: (t) => {
      delete e[t];
    },
  };
}
var y_ = {
    debug: !!(
      globalThis &&
      bs() &&
      globalThis.localStorage &&
      globalThis.localStorage.getItem("supabase.gotrue-js.locks.debug") === "true"
    ),
  },
  As = class extends Error {
    constructor(t) {
      (super(t), (this.isAcquireTimeout = !0));
    }
  };
function zm() {
  if (typeof globalThis != "object")
    try {
      (Object.defineProperty(Object.prototype, "__magic__", {
        get: function () {
          return this;
        },
        configurable: !0,
      }),
        (__magic__.globalThis = __magic__),
        delete Object.prototype.__magic__);
    } catch {
      typeof self < "u" && (self.globalThis = self);
    }
}
function Lc(e) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(e)) throw new Error(`@supabase/auth-js: Address "${e}" is invalid.`);
  return e.toLowerCase();
}
function jm(e) {
  return parseInt(e, 16);
}
function Mm(e) {
  let t = new TextEncoder().encode(e);
  return "0x" + Array.from(t, (i) => i.toString(16).padStart(2, "0")).join("");
}
function qm(e) {
  var t;
  let {
    chainId: n,
    domain: i,
    expirationTime: a,
    issuedAt: l = new Date(),
    nonce: r,
    notBefore: s,
    requestId: u,
    resources: o,
    scheme: f,
    uri: m,
    version: d,
  } = e;
  {
    if (!Number.isInteger(n))
      throw new Error(
        `@supabase/auth-js: Invalid SIWE message field "chainId". Chain ID must be a EIP-155 chain ID. Provided value: ${n}`,
      );
    if (!i) throw new Error('@supabase/auth-js: Invalid SIWE message field "domain". Domain must be provided.');
    if (r && r.length < 8)
      throw new Error(
        `@supabase/auth-js: Invalid SIWE message field "nonce". Nonce must be at least 8 characters. Provided value: ${r}`,
      );
    if (!m) throw new Error('@supabase/auth-js: Invalid SIWE message field "uri". URI must be provided.');
    if (d !== "1")
      throw new Error(
        `@supabase/auth-js: Invalid SIWE message field "version". Version must be '1'. Provided value: ${d}`,
      );
    if (
      !((t = e.statement) === null || t === void 0) &&
      t.includes(`
`)
    )
      throw new Error(
        `@supabase/auth-js: Invalid SIWE message field "statement". Statement must not include '\\n'. Provided value: ${e.statement}`,
      );
  }
  let g = Lc(e.address),
    _ = f ? `${f}://${i}` : i,
    b = e.statement
      ? `${e.statement}
`
      : "",
    A = `${_} wants you to sign in with your Ethereum account:
${g}

${b}`,
    y = `URI: ${m}
Version: ${d}
Chain ID: ${n}${
      r
        ? `
Nonce: ${r}`
        : ""
    }
Issued At: ${l.toISOString()}`;
  if (
    (a &&
      (y += `
Expiration Time: ${a.toISOString()}`),
    s &&
      (y += `
Not Before: ${s.toISOString()}`),
    u &&
      (y += `
Request ID: ${u}`),
    o)
  ) {
    let c = `
Resources:`;
    for (let h of o) {
      if (!h || typeof h != "string")
        throw new Error(
          `@supabase/auth-js: Invalid SIWE message field "resources". Every resource must be a valid string. Provided value: ${h}`,
        );
      c += `
- ${h}`;
    }
    y += c;
  }
  return `${A}
${y}`;
}
var te = class extends Error {
    constructor({ message: t, code: n, cause: i, name: a }) {
      var l;
      (super(t, { cause: i }),
        (this.__isWebAuthnError = !0),
        (this.name = (l = a ?? (i instanceof Error ? i.name : void 0)) !== null && l !== void 0 ? l : "Unknown Error"),
        (this.code = n));
    }
    toJSON() {
      return { name: this.name, message: this.message, code: this.code };
    }
  },
  di = class extends te {
    constructor(t, n) {
      (super({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: n, message: t }),
        (this.name = "WebAuthnUnknownError"),
        (this.originalError = n));
    }
  };
function Lm({ error: e, options: t }) {
  var n, i, a;
  let { publicKey: l } = t;
  if (!l) throw Error("options was missing required publicKey property");
  if (e.name === "AbortError") {
    if (t.signal instanceof AbortSignal)
      return new te({
        message: "Registration ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: e,
      });
  } else if (e.name === "ConstraintError") {
    if (((n = l.authenticatorSelection) === null || n === void 0 ? void 0 : n.requireResidentKey) === !0)
      return new te({
        message: "Discoverable credentials were required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
        cause: e,
      });
    if (
      t.mediation === "conditional" &&
      ((i = l.authenticatorSelection) === null || i === void 0 ? void 0 : i.userVerification) === "required"
    )
      return new te({
        message: "User verification was required during automatic registration but it could not be performed",
        code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
        cause: e,
      });
    if (((a = l.authenticatorSelection) === null || a === void 0 ? void 0 : a.userVerification) === "required")
      return new te({
        message: "User verification was required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
        cause: e,
      });
  } else {
    if (e.name === "InvalidStateError")
      return new te({
        message: "The authenticator was previously registered",
        code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
        cause: e,
      });
    if (e.name === "NotAllowedError")
      return new te({ message: e.message, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: e });
    if (e.name === "NotSupportedError")
      return l.pubKeyCredParams.filter((s) => s.type === "public-key").length === 0
        ? new te({
            message: 'No entry in pubKeyCredParams was of type "public-key"',
            code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
            cause: e,
          })
        : new te({
            message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
            code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
            cause: e,
          });
    if (e.name === "SecurityError") {
      let r = window.location.hostname;
      if (Hc(r)) {
        if (l.rp.id !== r)
          return new te({
            message: `The RP ID "${l.rp.id}" is invalid for this domain`,
            code: "ERROR_INVALID_RP_ID",
            cause: e,
          });
      } else
        return new te({
          message: `${window.location.hostname} is an invalid domain`,
          code: "ERROR_INVALID_DOMAIN",
          cause: e,
        });
    } else if (e.name === "TypeError") {
      if (l.user.id.byteLength < 1 || l.user.id.byteLength > 64)
        return new te({
          message: "User ID was not between 1 and 64 characters",
          code: "ERROR_INVALID_USER_ID_LENGTH",
          cause: e,
        });
    } else if (e.name === "UnknownError")
      return new te({
        message: "The authenticator was unable to process the specified options, or could not create a new credential",
        code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
        cause: e,
      });
  }
  return new te({
    message: "a Non-Webauthn related error has occurred",
    code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    cause: e,
  });
}
function Hm({ error: e, options: t }) {
  let { publicKey: n } = t;
  if (!n) throw Error("options was missing required publicKey property");
  if (e.name === "AbortError") {
    if (t.signal instanceof AbortSignal)
      return new te({
        message: "Authentication ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: e,
      });
  } else {
    if (e.name === "NotAllowedError")
      return new te({ message: e.message, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: e });
    if (e.name === "SecurityError") {
      let i = window.location.hostname;
      if (Hc(i)) {
        if (n.rpId !== i)
          return new te({
            message: `The RP ID "${n.rpId}" is invalid for this domain`,
            code: "ERROR_INVALID_RP_ID",
            cause: e,
          });
      } else
        return new te({
          message: `${window.location.hostname} is an invalid domain`,
          code: "ERROR_INVALID_DOMAIN",
          cause: e,
        });
    } else if (e.name === "UnknownError")
      return new te({
        message:
          "The authenticator was unable to process the specified options, or could not create a new assertion signature",
        code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
        cause: e,
      });
  }
  return new te({
    message: "a Non-Webauthn related error has occurred",
    code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    cause: e,
  });
}
var Bc = class {
    createNewAbortSignal() {
      if (this.controller) {
        let n = new Error("Cancelling existing WebAuthn API call for new one");
        ((n.name = "AbortError"), this.controller.abort(n));
      }
      let t = new AbortController();
      return ((this.controller = t), t.signal);
    }
    cancelCeremony() {
      if (this.controller) {
        let t = new Error("Manually cancelling existing WebAuthn API call");
        ((t.name = "AbortError"), this.controller.abort(t), (this.controller = void 0));
      }
    }
  },
  Os = new Bc();
function Gc(e) {
  if (!e) throw new Error("Credential creation options are required");
  if (
    typeof PublicKeyCredential < "u" &&
    "parseCreationOptionsFromJSON" in PublicKeyCredential &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON == "function"
  )
    return PublicKeyCredential.parseCreationOptionsFromJSON(e);
  let { challenge: t, user: n, excludeCredentials: i } = e,
    a = ai(e, ["challenge", "user", "excludeCredentials"]),
    l = Dn(t).buffer,
    r = Object.assign(Object.assign({}, n), { id: Dn(n.id).buffer }),
    s = Object.assign(Object.assign({}, a), { challenge: l, user: r });
  if (i && i.length > 0) {
    s.excludeCredentials = new Array(i.length);
    for (let u = 0; u < i.length; u++) {
      let o = i[u];
      s.excludeCredentials[u] = Object.assign(Object.assign({}, o), {
        id: Dn(o.id).buffer,
        type: o.type || "public-key",
        transports: o.transports,
      });
    }
  }
  return s;
}
function Kc(e) {
  if (!e) throw new Error("Credential request options are required");
  if (
    typeof PublicKeyCredential < "u" &&
    "parseRequestOptionsFromJSON" in PublicKeyCredential &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON == "function"
  )
    return PublicKeyCredential.parseRequestOptionsFromJSON(e);
  let { challenge: t, allowCredentials: n } = e,
    i = ai(e, ["challenge", "allowCredentials"]),
    a = Dn(t).buffer,
    l = Object.assign(Object.assign({}, i), { challenge: a });
  if (n && n.length > 0) {
    l.allowCredentials = new Array(n.length);
    for (let r = 0; r < n.length; r++) {
      let s = n[r];
      l.allowCredentials[r] = Object.assign(Object.assign({}, s), {
        id: Dn(s.id).buffer,
        type: s.type || "public-key",
        transports: s.transports,
      });
    }
  }
  return l;
}
function Yc(e) {
  var t;
  if ("toJSON" in e && typeof e.toJSON == "function") return e.toJSON();
  let n = e;
  return {
    id: e.id,
    rawId: e.id,
    response: {
      attestationObject: $t(new Uint8Array(e.response.attestationObject)),
      clientDataJSON: $t(new Uint8Array(e.response.clientDataJSON)),
    },
    type: "public-key",
    clientExtensionResults: e.getClientExtensionResults(),
    authenticatorAttachment: (t = n.authenticatorAttachment) !== null && t !== void 0 ? t : void 0,
  };
}
function Ic(e) {
  var t;
  if ("toJSON" in e && typeof e.toJSON == "function") return e.toJSON();
  let n = e,
    i = e.getClientExtensionResults(),
    a = e.response;
  return {
    id: e.id,
    rawId: e.id,
    response: {
      authenticatorData: $t(new Uint8Array(a.authenticatorData)),
      clientDataJSON: $t(new Uint8Array(a.clientDataJSON)),
      signature: $t(new Uint8Array(a.signature)),
      userHandle: a.userHandle ? $t(new Uint8Array(a.userHandle)) : void 0,
    },
    type: "public-key",
    clientExtensionResults: i,
    authenticatorAttachment: (t = n.authenticatorAttachment) !== null && t !== void 0 ? t : void 0,
  };
}
function Hc(e) {
  return e === "localhost" || /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(e);
}
function kl() {
  var e, t;
  return !!(
    _e() &&
    "PublicKeyCredential" in window &&
    window.PublicKeyCredential &&
    "credentials" in navigator &&
    typeof ((e = navigator?.credentials) === null || e === void 0 ? void 0 : e.create) == "function" &&
    typeof ((t = navigator?.credentials) === null || t === void 0 ? void 0 : t.get) == "function"
  );
}
async function Vc(e) {
  try {
    let t = await navigator.credentials.create(e);
    return t
      ? t instanceof PublicKeyCredential
        ? { data: t, error: null }
        : { data: null, error: new di("Browser returned unexpected credential type", t) }
      : { data: null, error: new di("Empty credential response", t) };
  } catch (t) {
    return { data: null, error: Lm({ error: t, options: e }) };
  }
}
async function Xc(e) {
  try {
    let t = await navigator.credentials.get(e);
    return t
      ? t instanceof PublicKeyCredential
        ? { data: t, error: null }
        : { data: null, error: new di("Browser returned unexpected credential type", t) }
      : { data: null, error: new di("Empty credential response", t) };
  } catch (t) {
    return { data: null, error: Hm({ error: t, options: e }) };
  }
}
var m_ = {
    hints: ["security-key"],
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      requireResidentKey: !1,
      userVerification: "preferred",
      residentKey: "discouraged",
    },
    attestation: "direct",
  },
  v_ = { userVerification: "preferred", hints: ["security-key"], attestation: "direct" };
function Rs(...e) {
  let t = (a) => a !== null && typeof a == "object" && !Array.isArray(a),
    n = (a) => a instanceof ArrayBuffer || ArrayBuffer.isView(a),
    i = {};
  for (let a of e)
    if (a)
      for (let l in a) {
        let r = a[l];
        if (r !== void 0)
          if (Array.isArray(r)) i[l] = r;
          else if (n(r)) i[l] = r;
          else if (t(r)) {
            let s = i[l];
            t(s) ? (i[l] = Rs(s, r)) : (i[l] = Rs(r));
          } else i[l] = r;
      }
  return i;
}
function p_(e, t) {
  return Rs(m_, e, t || {});
}
function __(e, t) {
  return Rs(v_, e, t || {});
}
var Ts = class {
  constructor(t) {
    ((this.client = t),
      (this.enroll = this._enroll.bind(this)),
      (this.challenge = this._challenge.bind(this)),
      (this.verify = this._verify.bind(this)),
      (this.authenticate = this._authenticate.bind(this)),
      (this.register = this._register.bind(this)));
  }
  async _enroll(t) {
    return this.client.mfa.enroll(Object.assign(Object.assign({}, t), { factorType: "webauthn" }));
  }
  async _challenge({ factorId: t, webauthn: n, friendlyName: i, signal: a }, l) {
    var r;
    try {
      let { data: s, error: u } = await this.client.mfa.challenge({ factorId: t, webauthn: n });
      if (!s) return { data: null, error: u };
      let o = a ?? Os.createNewAbortSignal();
      if (s.webauthn.type === "create") {
        let { user: f } = s.webauthn.credential_options.publicKey;
        if (!f.name) {
          let m = i;
          if (m) f.name = `${f.id}:${m}`;
          else {
            let g = (await this.client.getUser()).data.user,
              _ = ((r = g?.user_metadata) === null || r === void 0 ? void 0 : r.name) || g?.email || g?.id || "User";
            f.name = `${f.id}:${_}`;
          }
        }
        f.displayName || (f.displayName = f.name);
      }
      switch (s.webauthn.type) {
        case "create": {
          let f = p_(s.webauthn.credential_options.publicKey, l?.create),
            { data: m, error: d } = await Vc({ publicKey: f, signal: o });
          return m
            ? {
                data: { factorId: t, challengeId: s.id, webauthn: { type: s.webauthn.type, credential_response: m } },
                error: null,
              }
            : { data: null, error: d };
        }
        case "request": {
          let f = __(s.webauthn.credential_options.publicKey, l?.request),
            { data: m, error: d } = await Xc(
              Object.assign(Object.assign({}, s.webauthn.credential_options), { publicKey: f, signal: o }),
            );
          return m
            ? {
                data: { factorId: t, challengeId: s.id, webauthn: { type: s.webauthn.type, credential_response: m } },
                error: null,
              }
            : { data: null, error: d };
        }
      }
    } catch (s) {
      return S(s) ? { data: null, error: s } : { data: null, error: new Oe("Unexpected error in challenge", s) };
    }
  }
  async _verify({ challengeId: t, factorId: n, webauthn: i }) {
    return this.client.mfa.verify({ factorId: n, challengeId: t, webauthn: i });
  }
  async _authenticate(
    {
      factorId: t,
      webauthn: {
        rpId: n = typeof window < "u" ? window.location.hostname : void 0,
        rpOrigins: i = typeof window < "u" ? [window.location.origin] : void 0,
        signal: a,
      } = {},
    },
    l,
  ) {
    if (!n) return { data: null, error: new Un("rpId is required for WebAuthn authentication") };
    try {
      if (!kl()) return { data: null, error: new Oe("Browser does not support WebAuthn", null) };
      let { data: r, error: s } = await this.challenge(
        { factorId: t, webauthn: { rpId: n, rpOrigins: i }, signal: a },
        { request: l },
      );
      if (!r) return { data: null, error: s };
      let { webauthn: u } = r;
      return this._verify({
        factorId: t,
        challengeId: r.challengeId,
        webauthn: { type: u.type, rpId: n, rpOrigins: i, credential_response: u.credential_response },
      });
    } catch (r) {
      return S(r) ? { data: null, error: r } : { data: null, error: new Oe("Unexpected error in authenticate", r) };
    }
  }
  async _register(
    {
      friendlyName: t,
      webauthn: {
        rpId: n = typeof window < "u" ? window.location.hostname : void 0,
        rpOrigins: i = typeof window < "u" ? [window.location.origin] : void 0,
        signal: a,
      } = {},
    },
    l,
  ) {
    if (!n) return { data: null, error: new Un("rpId is required for WebAuthn registration") };
    try {
      if (!kl()) return { data: null, error: new Oe("Browser does not support WebAuthn", null) };
      let { data: r, error: s } = await this._enroll({ friendlyName: t });
      if (!r)
        return (
          await this.client.mfa
            .listFactors()
            .then((f) => {
              var m;
              return (m = f.data) === null || m === void 0
                ? void 0
                : m.all.find((d) => d.factor_type === "webauthn" && d.friendly_name === t && d.status !== "unverified");
            })
            .then((f) => (f ? this.client.mfa.unenroll({ factorId: f?.id }) : void 0)),
          { data: null, error: s }
        );
      let { data: u, error: o } = await this._challenge(
        { factorId: r.id, friendlyName: r.friendly_name, webauthn: { rpId: n, rpOrigins: i }, signal: a },
        { create: l },
      );
      return u
        ? this._verify({
            factorId: r.id,
            challengeId: u.challengeId,
            webauthn: {
              rpId: n,
              rpOrigins: i,
              type: u.webauthn.type,
              credential_response: u.webauthn.credential_response,
            },
          })
        : { data: null, error: o };
    } catch (r) {
      return S(r) ? { data: null, error: r } : { data: null, error: new Oe("Unexpected error in register", r) };
    }
  }
};
zm();
var b_ = {
  url: om,
  storageKey: cm,
  autoRefreshToken: !0,
  persistSession: !0,
  detectSessionInUrl: !0,
  headers: fm,
  flowType: "implicit",
  debug: !1,
  hasCustomAuthorizationHeader: !1,
  throwOnError: !1,
  lockAcquireTimeout: 5e3,
  skipAutoInitialize: !1,
  experimental: {},
};
var ha = {},
  xs = class e {
    get jwks() {
      var t, n;
      return (n = (t = ha[this.storageKey]) === null || t === void 0 ? void 0 : t.jwks) !== null && n !== void 0
        ? n
        : { keys: [] };
    }
    set jwks(t) {
      ha[this.storageKey] = Object.assign(Object.assign({}, ha[this.storageKey]), { jwks: t });
    }
    get jwks_cached_at() {
      var t, n;
      return (n = (t = ha[this.storageKey]) === null || t === void 0 ? void 0 : t.cachedAt) !== null && n !== void 0
        ? n
        : Number.MIN_SAFE_INTEGER;
    }
    set jwks_cached_at(t) {
      ha[this.storageKey] = Object.assign(Object.assign({}, ha[this.storageKey]), { cachedAt: t });
    }
    constructor(t) {
      var n, i, a;
      ((this.userStorage = null),
        (this.memoryStorage = null),
        (this.stateChangeEmitters = new Map()),
        (this.autoRefreshTicker = null),
        (this.autoRefreshTickTimeout = null),
        (this.visibilityChangedCallback = null),
        (this.refreshingDeferred = null),
        (this.lastRefreshFailure = null),
        (this._sessionRemovalEpoch = 0),
        (this.initializePromise = null),
        (this.detectSessionInUrl = !0),
        (this.hasCustomAuthorizationHeader = !1),
        (this.suppressGetSessionWarning = !1),
        (this.lock = null),
        (this.lockAcquired = !1),
        (this.pendingInLock = []),
        (this.broadcastChannel = null),
        (this.logger = console.log));
      let l = Object.assign(Object.assign({}, b_), t);
      if (
        ((this.storageKey = l.storageKey),
        (this.instanceID = (n = e.nextInstanceID[this.storageKey]) !== null && n !== void 0 ? n : 0),
        (e.nextInstanceID[this.storageKey] = this.instanceID + 1),
        (this.logDebugMessages = !!l.debug),
        typeof l.debug == "function" && (this.logger = l.debug),
        this.instanceID > 0 && _e())
      ) {
        let r = `${this._logPrefix()} Multiple GoTrueClient instances detected in the same browser context. It is not an error, but this should be avoided as it may produce undefined behavior when used concurrently under the same storage key.`;
        (console.warn(r), this.logDebugMessages && console.trace(r));
      }
      if (
        ((this.persistSession = l.persistSession),
        (this.autoRefreshToken = l.autoRefreshToken),
        (this.experimental = (i = l.experimental) !== null && i !== void 0 ? i : {}),
        (this.admin = new fi({ url: l.url, headers: l.headers, fetch: l.fetch, experimental: this.experimental })),
        (this.url = l.url),
        (this.headers = l.headers),
        (this.fetch = ws(l.fetch)),
        (this.detectSessionInUrl = l.detectSessionInUrl),
        (this.flowType = l.flowType),
        (this.hasCustomAuthorizationHeader = l.hasCustomAuthorizationHeader),
        (this.throwOnError = l.throwOnError),
        (this.lockAcquireTimeout = l.lockAcquireTimeout),
        l.lock != null && (this.lock = l.lock),
        this.jwks || ((this.jwks = { keys: [] }), (this.jwks_cached_at = Number.MIN_SAFE_INTEGER)),
        (this.mfa = {
          verify: this._verify.bind(this),
          enroll: this._enroll.bind(this),
          unenroll: this._unenroll.bind(this),
          challenge: this._challenge.bind(this),
          listFactors: this._listFactors.bind(this),
          challengeAndVerify: this._challengeAndVerify.bind(this),
          getAuthenticatorAssuranceLevel: this._getAuthenticatorAssuranceLevel.bind(this),
          webauthn: new Ts(this),
        }),
        (this.oauth = {
          getAuthorizationDetails: this._getAuthorizationDetails.bind(this),
          approveAuthorization: this._approveAuthorization.bind(this),
          denyAuthorization: this._denyAuthorization.bind(this),
          listGrants: this._listOAuthGrants.bind(this),
          revokeGrant: this._revokeOAuthGrant.bind(this),
        }),
        (this.passkey = {
          startRegistration: this._startPasskeyRegistration.bind(this),
          verifyRegistration: this._verifyPasskeyRegistration.bind(this),
          startAuthentication: this._startPasskeyAuthentication.bind(this),
          verifyAuthentication: this._verifyPasskeyAuthentication.bind(this),
          list: this._listPasskeys.bind(this),
          update: this._updatePasskey.bind(this),
          delete: this._deletePasskey.bind(this),
        }),
        this.persistSession
          ? (l.storage
              ? (this.storage = l.storage)
              : bs()
                ? (this.storage = globalThis.localStorage)
                : ((this.memoryStorage = {}), (this.storage = qc(this.memoryStorage))),
            l.userStorage && (this.userStorage = l.userStorage))
          : ((this.memoryStorage = {}), (this.storage = qc(this.memoryStorage))),
        _e() && globalThis.BroadcastChannel && this.persistSession && this.storageKey)
      ) {
        try {
          this.broadcastChannel = new globalThis.BroadcastChannel(this.storageKey);
        } catch (r) {
          console.error("Failed to create a new BroadcastChannel, multi-tab state changes will not be available", r);
        }
        (a = this.broadcastChannel) === null ||
          a === void 0 ||
          a.addEventListener("message", async (r) => {
            (this._debug("received broadcast notification from other tab or client", r),
              (r.data.event === "TOKEN_REFRESHED" || r.data.event === "SIGNED_IN") && (this.lastRefreshFailure = null));
            try {
              await this._notifyAllSubscribers(r.data.event, r.data.session, !1);
            } catch (s) {
              this._debug("#broadcastChannel", "error", s);
            }
          });
      }
      l.skipAutoInitialize ||
        this.initialize().catch((r) => {
          this._debug("#initialize()", "error", r);
        });
    }
    isThrowOnErrorEnabled() {
      return this.throwOnError;
    }
    _returnResult(t) {
      if (this.throwOnError && t && t.error) throw t.error;
      return t;
    }
    _logPrefix() {
      return `GoTrueClient@${this.storageKey}:${this.instanceID} (${ys}) ${new Date().toISOString()}`;
    }
    _debug(...t) {
      return (this.logDebugMessages && this.logger(this._logPrefix(), ...t), this);
    }
    async initialize() {
      return this.initializePromise
        ? await this.initializePromise
        : ((this.initializePromise = (async () =>
            this.lock != null
              ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._initialize())
              : await this._initialize())()),
          await this.initializePromise);
    }
    async _initialize() {
      var t;
      try {
        let n = {},
          i = "none";
        if (
          (_e() &&
            ((n = Em(window.location.href)),
            this._isImplicitGrantCallback(n) ? (i = "implicit") : (await this._isPKCECallback(n)) && (i = "pkce")),
          _e() && this.detectSessionInUrl && i !== "none")
        ) {
          let { data: a, error: l } = await this._getSessionFromURL(n, i);
          if (l) {
            if ((this._debug("#_initialize()", "error detecting session from URL", l), ym(l))) {
              let u = (t = l.details) === null || t === void 0 ? void 0 : t.code;
              if (
                u === "identity_already_exists" ||
                u === "identity_not_found" ||
                u === "single_identity_not_deletable"
              )
                return { error: l };
            }
            return { error: l };
          }
          let { session: r, redirectType: s } = a;
          return (
            this._debug("#_initialize()", "detected session in URL", r, "redirect type", s),
            await this._saveSession(r),
            setTimeout(async () => {
              s === "recovery"
                ? await this._notifyAllSubscribers("PASSWORD_RECOVERY", r)
                : await this._notifyAllSubscribers("SIGNED_IN", r);
            }, 0),
            { error: null }
          );
        }
        return (await this._recoverAndRefresh(), { error: null });
      } catch (n) {
        return S(n)
          ? this._returnResult({ error: n })
          : this._returnResult({ error: new Oe("Unexpected error during initialization", n) });
      } finally {
        (await this._handleVisibilityChange(), this._debug("#_initialize()", "end"));
      }
    }
    async signInAnonymously(t) {
      var n, i, a;
      try {
        let l = await R(this.fetch, "POST", `${this.url}/signup`, {
            headers: this.headers,
            body: {
              data: (i = (n = t?.options) === null || n === void 0 ? void 0 : n.data) !== null && i !== void 0 ? i : {},
              gotrue_meta_security: {
                captcha_token: (a = t?.options) === null || a === void 0 ? void 0 : a.captchaToken,
              },
            },
            xform: We,
          }),
          { data: r, error: s } = l;
        if (s || !r) return this._returnResult({ data: { user: null, session: null }, error: s });
        let u = r.session,
          o = r.user;
        return (
          r.session && (await this._saveSession(r.session), await this._notifyAllSubscribers("SIGNED_IN", u)),
          this._returnResult({ data: { user: o, session: u }, error: null })
        );
      } catch (l) {
        if (S(l)) return this._returnResult({ data: { user: null, session: null }, error: l });
        throw l;
      }
    }
    async signUp(t) {
      var n, i, a;
      try {
        let l;
        if ("email" in t) {
          let { email: f, password: m, options: d } = t,
            g = null,
            _ = null;
          (this.flowType === "pkce" && ([g, _] = await zn(this.storage, this.storageKey)),
            (l = await R(this.fetch, "POST", `${this.url}/signup`, {
              headers: this.headers,
              redirectTo: d?.emailRedirectTo,
              body: {
                email: f,
                password: m,
                data: (n = d?.data) !== null && n !== void 0 ? n : {},
                gotrue_meta_security: { captcha_token: d?.captchaToken },
                code_challenge: g,
                code_challenge_method: _,
              },
              xform: We,
            })));
        } else if ("phone" in t) {
          let { phone: f, password: m, options: d } = t;
          l = await R(this.fetch, "POST", `${this.url}/signup`, {
            headers: this.headers,
            body: {
              phone: f,
              password: m,
              data: (i = d?.data) !== null && i !== void 0 ? i : {},
              channel: (a = d?.channel) !== null && a !== void 0 ? a : "sms",
              gotrue_meta_security: { captcha_token: d?.captchaToken },
            },
            xform: We,
          });
        } else throw new li("You must provide either an email or phone number and a password");
        let { data: r, error: s } = l;
        if (s || !r)
          return (
            await re(this.storage, `${this.storageKey}-code-verifier`),
            this._returnResult({ data: { user: null, session: null }, error: s })
          );
        let u = r.session,
          o = r.user;
        return (
          r.session && (await this._saveSession(r.session), await this._notifyAllSubscribers("SIGNED_IN", u)),
          this._returnResult({ data: { user: o, session: u }, error: null })
        );
      } catch (l) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(l)))
          return this._returnResult({ data: { user: null, session: null }, error: l });
        throw l;
      }
    }
    async signInWithPassword(t) {
      try {
        let n;
        if ("email" in t) {
          let { email: l, password: r, options: s } = t;
          n = await R(this.fetch, "POST", `${this.url}/token?grant_type=password`, {
            headers: this.headers,
            body: { email: l, password: r, gotrue_meta_security: { captcha_token: s?.captchaToken } },
            xform: jc,
          });
        } else if ("phone" in t) {
          let { phone: l, password: r, options: s } = t;
          n = await R(this.fetch, "POST", `${this.url}/token?grant_type=password`, {
            headers: this.headers,
            body: { phone: l, password: r, gotrue_meta_security: { captcha_token: s?.captchaToken } },
            xform: jc,
          });
        } else throw new li("You must provide either an email or phone number and a password");
        let { data: i, error: a } = n;
        if (a) return this._returnResult({ data: { user: null, session: null }, error: a });
        if (!i || !i.session || !i.user) {
          let l = new Zt();
          return this._returnResult({ data: { user: null, session: null }, error: l });
        }
        return (
          i.session && (await this._saveSession(i.session), await this._notifyAllSubscribers("SIGNED_IN", i.session)),
          this._returnResult({
            data: Object.assign(
              { user: i.user, session: i.session },
              i.weak_password ? { weakPassword: i.weak_password } : null,
            ),
            error: a,
          })
        );
      } catch (n) {
        if (S(n)) return this._returnResult({ data: { user: null, session: null }, error: n });
        throw n;
      }
    }
    async signInWithOAuth(t) {
      var n, i, a, l;
      return await this._handleProviderSignIn(t.provider, {
        redirectTo: (n = t.options) === null || n === void 0 ? void 0 : n.redirectTo,
        scopes: (i = t.options) === null || i === void 0 ? void 0 : i.scopes,
        queryParams: (a = t.options) === null || a === void 0 ? void 0 : a.queryParams,
        skipBrowserRedirect: (l = t.options) === null || l === void 0 ? void 0 : l.skipBrowserRedirect,
      });
    }
    async exchangeCodeForSession(t) {
      return (
        await this.initializePromise,
        this.lock != null
          ? this._acquireLock(this.lockAcquireTimeout, async () => this._exchangeCodeForSession(t))
          : this._exchangeCodeForSession(t)
      );
    }
    async signInWithWeb3(t) {
      let { chain: n } = t;
      switch (n) {
        case "ethereum":
          return await this.signInWithEthereum(t);
        case "solana":
          return await this.signInWithSolana(t);
        default:
          throw new Error(`@supabase/auth-js: Unsupported chain "${n}"`);
      }
    }
    async signInWithEthereum(t) {
      var n, i, a, l, r, s, u, o, f, m, d;
      let g, _;
      if ("message" in t) ((g = t.message), (_ = t.signature));
      else {
        let { chain: b, wallet: A, statement: y, options: c } = t,
          h;
        if (_e())
          if (typeof A == "object") h = A;
          else {
            let C = window;
            if (
              "ethereum" in C &&
              typeof C.ethereum == "object" &&
              "request" in C.ethereum &&
              typeof C.ethereum.request == "function"
            )
              h = C.ethereum;
            else
              throw new Error(
                "@supabase/auth-js: No compatible Ethereum wallet interface on the window object (window.ethereum) detected. Make sure the user already has a wallet installed and connected for this app. Prefer passing the wallet interface object directly to signInWithWeb3({ chain: 'ethereum', wallet: resolvedUserWallet }) instead.",
              );
          }
        else {
          if (typeof A != "object" || !c?.url)
            throw new Error("@supabase/auth-js: Both wallet and url must be specified in non-browser environments.");
          h = A;
        }
        let v = new URL((n = c?.url) !== null && n !== void 0 ? n : window.location.href),
          E = await h
            .request({ method: "eth_requestAccounts" })
            .then((C) => C)
            .catch(() => {
              throw new Error("@supabase/auth-js: Wallet method eth_requestAccounts is missing or invalid");
            });
        if (!E || E.length === 0)
          throw new Error("@supabase/auth-js: No accounts available. Please ensure the wallet is connected.");
        let O = Lc(E[0]),
          w = (i = c?.signInWithEthereum) === null || i === void 0 ? void 0 : i.chainId;
        if (!w) {
          let C = await h.request({ method: "eth_chainId" });
          w = jm(C);
        }
        let x = {
          domain: v.host,
          address: O,
          statement: y,
          uri: v.href,
          version: "1",
          chainId: w,
          nonce: (a = c?.signInWithEthereum) === null || a === void 0 ? void 0 : a.nonce,
          issuedAt:
            (r = (l = c?.signInWithEthereum) === null || l === void 0 ? void 0 : l.issuedAt) !== null && r !== void 0
              ? r
              : new Date(),
          expirationTime: (s = c?.signInWithEthereum) === null || s === void 0 ? void 0 : s.expirationTime,
          notBefore: (u = c?.signInWithEthereum) === null || u === void 0 ? void 0 : u.notBefore,
          requestId: (o = c?.signInWithEthereum) === null || o === void 0 ? void 0 : o.requestId,
          resources: (f = c?.signInWithEthereum) === null || f === void 0 ? void 0 : f.resources,
        };
        ((g = qm(x)), (_ = await h.request({ method: "personal_sign", params: [Mm(g), O] })));
      }
      try {
        let { data: b, error: A } = await R(this.fetch, "POST", `${this.url}/token?grant_type=web3`, {
          headers: this.headers,
          body: Object.assign(
            { chain: "ethereum", message: g, signature: _ },
            !((m = t.options) === null || m === void 0) && m.captchaToken
              ? {
                  gotrue_meta_security: {
                    captcha_token: (d = t.options) === null || d === void 0 ? void 0 : d.captchaToken,
                  },
                }
              : null,
          ),
          xform: We,
        });
        if (A) throw A;
        if (!b || !b.session || !b.user) {
          let y = new Zt();
          return this._returnResult({ data: { user: null, session: null }, error: y });
        }
        return (
          b.session && (await this._saveSession(b.session), await this._notifyAllSubscribers("SIGNED_IN", b.session)),
          this._returnResult({ data: Object.assign({}, b), error: A })
        );
      } catch (b) {
        if (S(b)) return this._returnResult({ data: { user: null, session: null }, error: b });
        throw b;
      }
    }
    async signInWithSolana(t) {
      var n, i, a, l, r, s, u, o, f, m, d, g;
      let _, b;
      if ("message" in t) ((_ = t.message), (b = t.signature));
      else {
        let { chain: A, wallet: y, statement: c, options: h } = t,
          v;
        if (_e())
          if (typeof y == "object") v = y;
          else {
            let O = window;
            if (
              "solana" in O &&
              typeof O.solana == "object" &&
              (("signIn" in O.solana && typeof O.solana.signIn == "function") ||
                ("signMessage" in O.solana && typeof O.solana.signMessage == "function"))
            )
              v = O.solana;
            else
              throw new Error(
                "@supabase/auth-js: No compatible Solana wallet interface on the window object (window.solana) detected. Make sure the user already has a wallet installed and connected for this app. Prefer passing the wallet interface object directly to signInWithWeb3({ chain: 'solana', wallet: resolvedUserWallet }) instead.",
              );
          }
        else {
          if (typeof y != "object" || !h?.url)
            throw new Error("@supabase/auth-js: Both wallet and url must be specified in non-browser environments.");
          v = y;
        }
        let E = new URL((n = h?.url) !== null && n !== void 0 ? n : window.location.href);
        if ("signIn" in v && v.signIn) {
          let O = await v.signIn(
              Object.assign(
                Object.assign(Object.assign({ issuedAt: new Date().toISOString() }, h?.signInWithSolana), {
                  version: "1",
                  domain: E.host,
                  uri: E.href,
                }),
                c ? { statement: c } : null,
              ),
            ),
            w;
          if (Array.isArray(O) && O[0] && typeof O[0] == "object") w = O[0];
          else if (O && typeof O == "object" && "signedMessage" in O && "signature" in O) w = O;
          else throw new Error("@supabase/auth-js: Wallet method signIn() returned unrecognized value");
          if (
            "signedMessage" in w &&
            "signature" in w &&
            (typeof w.signedMessage == "string" || w.signedMessage instanceof Uint8Array) &&
            w.signature instanceof Uint8Array
          )
            ((_ = typeof w.signedMessage == "string" ? w.signedMessage : new TextDecoder().decode(w.signedMessage)),
              (b = w.signature));
          else
            throw new Error(
              "@supabase/auth-js: Wallet method signIn() API returned object without signedMessage and signature fields",
            );
        } else {
          if (
            !("signMessage" in v) ||
            typeof v.signMessage != "function" ||
            !("publicKey" in v) ||
            typeof v != "object" ||
            !v.publicKey ||
            !("toBase58" in v.publicKey) ||
            typeof v.publicKey.toBase58 != "function"
          )
            throw new Error(
              "@supabase/auth-js: Wallet does not have a compatible signMessage() and publicKey.toBase58() API",
            );
          _ = [
            `${E.host} wants you to sign in with your Solana account:`,
            v.publicKey.toBase58(),
            ...(c ? ["", c, ""] : [""]),
            "Version: 1",
            `URI: ${E.href}`,
            `Issued At: ${(a = (i = h?.signInWithSolana) === null || i === void 0 ? void 0 : i.issuedAt) !== null && a !== void 0 ? a : new Date().toISOString()}`,
            ...(!((l = h?.signInWithSolana) === null || l === void 0) && l.notBefore
              ? [`Not Before: ${h.signInWithSolana.notBefore}`]
              : []),
            ...(!((r = h?.signInWithSolana) === null || r === void 0) && r.expirationTime
              ? [`Expiration Time: ${h.signInWithSolana.expirationTime}`]
              : []),
            ...(!((s = h?.signInWithSolana) === null || s === void 0) && s.chainId
              ? [`Chain ID: ${h.signInWithSolana.chainId}`]
              : []),
            ...(!((u = h?.signInWithSolana) === null || u === void 0) && u.nonce
              ? [`Nonce: ${h.signInWithSolana.nonce}`]
              : []),
            ...(!((o = h?.signInWithSolana) === null || o === void 0) && o.requestId
              ? [`Request ID: ${h.signInWithSolana.requestId}`]
              : []),
            ...(!(
              (m = (f = h?.signInWithSolana) === null || f === void 0 ? void 0 : f.resources) === null || m === void 0
            ) && m.length
              ? ["Resources", ...h.signInWithSolana.resources.map((w) => `- ${w}`)]
              : []),
          ].join(`
`);
          let O = await v.signMessage(new TextEncoder().encode(_), "utf8");
          if (!O || !(O instanceof Uint8Array))
            throw new Error("@supabase/auth-js: Wallet signMessage() API returned an recognized value");
          b = O;
        }
      }
      try {
        let { data: A, error: y } = await R(this.fetch, "POST", `${this.url}/token?grant_type=web3`, {
          headers: this.headers,
          body: Object.assign(
            { chain: "solana", message: _, signature: $t(b) },
            !((d = t.options) === null || d === void 0) && d.captchaToken
              ? {
                  gotrue_meta_security: {
                    captcha_token: (g = t.options) === null || g === void 0 ? void 0 : g.captchaToken,
                  },
                }
              : null,
          ),
          xform: We,
        });
        if (y) throw y;
        if (!A || !A.session || !A.user) {
          let c = new Zt();
          return this._returnResult({ data: { user: null, session: null }, error: c });
        }
        return (
          A.session && (await this._saveSession(A.session), await this._notifyAllSubscribers("SIGNED_IN", A.session)),
          this._returnResult({ data: Object.assign({}, A), error: y })
        );
      } catch (A) {
        if (S(A)) return this._returnResult({ data: { user: null, session: null }, error: A });
        throw A;
      }
    }
    async _exchangeCodeForSession(t) {
      let n = await ct(this.storage, `${this.storageKey}-code-verifier`),
        [i, a] = (n ?? "").split("/");
      try {
        if (!i && this.flowType === "pkce") throw new ps();
        let { data: l, error: r } = await R(this.fetch, "POST", `${this.url}/token?grant_type=pkce`, {
          headers: this.headers,
          body: { auth_code: t, code_verifier: i },
          xform: We,
        });
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), r)) throw r;
        if (!l || !l.session || !l.user) {
          let s = new Zt();
          return this._returnResult({ data: { user: null, session: null, redirectType: null }, error: s });
        }
        return (
          l.session &&
            (await this._saveSession(l.session),
            await this._notifyAllSubscribers(a === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", l.session)),
          this._returnResult({ data: Object.assign(Object.assign({}, l), { redirectType: a ?? null }), error: r })
        );
      } catch (l) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(l)))
          return this._returnResult({ data: { user: null, session: null, redirectType: null }, error: l });
        throw l;
      }
    }
    async signInWithIdToken(t) {
      try {
        let { options: n, provider: i, token: a, access_token: l, nonce: r } = t,
          s = await R(this.fetch, "POST", `${this.url}/token?grant_type=id_token`, {
            headers: this.headers,
            body: {
              provider: i,
              id_token: a,
              access_token: l,
              nonce: r,
              gotrue_meta_security: { captcha_token: n?.captchaToken },
            },
            xform: We,
          }),
          { data: u, error: o } = s;
        if (o) return this._returnResult({ data: { user: null, session: null }, error: o });
        if (!u || !u.session || !u.user) {
          let f = new Zt();
          return this._returnResult({ data: { user: null, session: null }, error: f });
        }
        return (
          u.session && (await this._saveSession(u.session), await this._notifyAllSubscribers("SIGNED_IN", u.session)),
          this._returnResult({ data: u, error: o })
        );
      } catch (n) {
        if (S(n)) return this._returnResult({ data: { user: null, session: null }, error: n });
        throw n;
      }
    }
    async signInWithOtp(t) {
      var n, i, a, l, r;
      try {
        if ("email" in t) {
          let { email: s, options: u } = t,
            o = null,
            f = null;
          this.flowType === "pkce" && ([o, f] = await zn(this.storage, this.storageKey));
          let { error: m } = await R(this.fetch, "POST", `${this.url}/otp`, {
            headers: this.headers,
            body: {
              email: s,
              data: (n = u?.data) !== null && n !== void 0 ? n : {},
              create_user: (i = u?.shouldCreateUser) !== null && i !== void 0 ? i : !0,
              gotrue_meta_security: { captcha_token: u?.captchaToken },
              code_challenge: o,
              code_challenge_method: f,
            },
            redirectTo: u?.emailRedirectTo,
          });
          return this._returnResult({ data: { user: null, session: null }, error: m });
        }
        if ("phone" in t) {
          let { phone: s, options: u } = t,
            { data: o, error: f } = await R(this.fetch, "POST", `${this.url}/otp`, {
              headers: this.headers,
              body: {
                phone: s,
                data: (a = u?.data) !== null && a !== void 0 ? a : {},
                create_user: (l = u?.shouldCreateUser) !== null && l !== void 0 ? l : !0,
                gotrue_meta_security: { captcha_token: u?.captchaToken },
                channel: (r = u?.channel) !== null && r !== void 0 ? r : "sms",
              },
            });
          return this._returnResult({ data: { user: null, session: null, messageId: o?.message_id }, error: f });
        }
        throw new li("You must provide either an email or phone number.");
      } catch (s) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(s)))
          return this._returnResult({ data: { user: null, session: null }, error: s });
        throw s;
      }
    }
    async verifyOtp(t) {
      var n, i;
      try {
        let a, l;
        "options" in t &&
          ((a = (n = t.options) === null || n === void 0 ? void 0 : n.redirectTo),
          (l = (i = t.options) === null || i === void 0 ? void 0 : i.captchaToken));
        let { data: r, error: s } = await R(this.fetch, "POST", `${this.url}/verify`, {
          headers: this.headers,
          body: Object.assign(Object.assign({}, t), { gotrue_meta_security: { captcha_token: l } }),
          redirectTo: a,
          xform: We,
        });
        if (s) throw s;
        if (!r) throw new Error("An error occurred on token verification.");
        let u = r.session,
          o = r.user;
        return (
          u?.access_token &&
            (await this._saveSession(u),
            await this._notifyAllSubscribers(t.type == "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", u)),
          this._returnResult({ data: { user: o, session: u }, error: null })
        );
      } catch (a) {
        if (S(a)) return this._returnResult({ data: { user: null, session: null }, error: a });
        throw a;
      }
    }
    async signInWithSSO(t) {
      var n, i, a, l, r;
      try {
        let s = null,
          u = null;
        this.flowType === "pkce" && ([s, u] = await zn(this.storage, this.storageKey));
        let o = await R(this.fetch, "POST", `${this.url}/sso`, {
          body: Object.assign(
            Object.assign(
              Object.assign(
                Object.assign(
                  Object.assign({}, "providerId" in t ? { provider_id: t.providerId } : null),
                  "domain" in t ? { domain: t.domain } : null,
                ),
                {
                  redirect_to:
                    (i = (n = t.options) === null || n === void 0 ? void 0 : n.redirectTo) !== null && i !== void 0
                      ? i
                      : void 0,
                },
              ),
              !((a = t?.options) === null || a === void 0) && a.captchaToken
                ? { gotrue_meta_security: { captcha_token: t.options.captchaToken } }
                : null,
            ),
            { skip_http_redirect: !0, code_challenge: s, code_challenge_method: u },
          ),
          headers: this.headers,
          xform: Nm,
        });
        return (
          !((l = o.data) === null || l === void 0) &&
            l.url &&
            _e() &&
            !(!((r = t.options) === null || r === void 0) && r.skipBrowserRedirect) &&
            window.location.assign(o.data.url),
          this._returnResult(o)
        );
      } catch (s) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(s)))
          return this._returnResult({ data: null, error: s });
        throw s;
      }
    }
    async reauthenticate() {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._reauthenticate())
          : await this._reauthenticate()
      );
    }
    async _reauthenticate() {
      try {
        return await this._useSession(async (t) => {
          let {
            data: { session: n },
            error: i,
          } = t;
          if (i) throw i;
          if (!n) throw new le();
          let { error: a } = await R(this.fetch, "GET", `${this.url}/reauthenticate`, {
            headers: this.headers,
            jwt: n.access_token,
          });
          return this._returnResult({ data: { user: null, session: null }, error: a });
        });
      } catch (t) {
        if (S(t)) return this._returnResult({ data: { user: null, session: null }, error: t });
        throw t;
      }
    }
    async resend(t) {
      try {
        let n = `${this.url}/resend`;
        if ("email" in t) {
          let { email: i, type: a, options: l } = t,
            r = null,
            s = null;
          this.flowType === "pkce" && ([r, s] = await zn(this.storage, this.storageKey));
          let { error: u } = await R(this.fetch, "POST", n, {
            headers: this.headers,
            body: {
              email: i,
              type: a,
              gotrue_meta_security: { captcha_token: l?.captchaToken },
              code_challenge: r,
              code_challenge_method: s,
            },
            redirectTo: l?.emailRedirectTo,
          });
          return (
            u && (await re(this.storage, `${this.storageKey}-code-verifier`)),
            this._returnResult({ data: { user: null, session: null }, error: u })
          );
        } else if ("phone" in t) {
          let { phone: i, type: a, options: l } = t,
            { data: r, error: s } = await R(this.fetch, "POST", n, {
              headers: this.headers,
              body: { phone: i, type: a, gotrue_meta_security: { captcha_token: l?.captchaToken } },
            });
          return this._returnResult({ data: { user: null, session: null, messageId: r?.message_id }, error: s });
        }
        throw new li("You must provide either an email or phone number and a type");
      } catch (n) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(n)))
          return this._returnResult({ data: { user: null, session: null }, error: n });
        throw n;
      }
    }
    async getSession() {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => this._useSession(async (t) => t))
          : await this._useSession(async (t) => t)
      );
    }
    async _acquireLock(t, n) {
      this._debug("#_acquireLock", "begin", t);
      try {
        if (this.lockAcquired) {
          let i = this.pendingInLock.length ? this.pendingInLock[this.pendingInLock.length - 1] : Promise.resolve(),
            a = (async () => (await i, await n()))();
          return (
            this.pendingInLock.push(
              (async () => {
                try {
                  await a;
                } catch {}
              })(),
            ),
            a
          );
        }
        return await this.lock(`lock:${this.storageKey}`, t, async () => {
          this._debug("#_acquireLock", "lock acquired for storage key", this.storageKey);
          try {
            this.lockAcquired = !0;
            let i = n();
            for (
              this.pendingInLock.push(
                (async () => {
                  try {
                    await i;
                  } catch {}
                })(),
              ),
                await i;
              this.pendingInLock.length;
            ) {
              let a = [...this.pendingInLock];
              (await Promise.all(a), this.pendingInLock.splice(0, a.length));
            }
            return await i;
          } finally {
            (this._debug("#_acquireLock", "lock released for storage key", this.storageKey), (this.lockAcquired = !1));
          }
        });
      } finally {
        this._debug("#_acquireLock", "end");
      }
    }
    async _useSession(t) {
      this._debug("#_useSession", "begin");
      try {
        let n = await this.__loadSession();
        return await t(n);
      } finally {
        this._debug("#_useSession", "end");
      }
    }
    async __loadSession() {
      (this._debug("#__loadSession()", "begin"),
        this.lock != null &&
          !this.lockAcquired &&
          this._debug("#__loadSession()", "used outside of an acquired lock!", new Error().stack));
      try {
        let t = null,
          n = await ct(this.storage, this.storageKey);
        if (
          (this._debug("#getSession()", "session from storage", n),
          n !== null &&
            (this._isValidSession(n)
              ? (t = n)
              : (this._debug("#getSession()", "session from storage is not valid"), await this._removeSession())),
          !t)
        )
          return { data: { session: null }, error: null };
        let i = t.expires_at ? t.expires_at * 1e3 - Date.now() < ms : !1;
        if (
          (this._debug("#__loadSession()", `session has${i ? "" : " not"} expired`, "expires_at", t.expires_at), !i)
        ) {
          if (this.userStorage) {
            let r = await ct(this.userStorage, this.storageKey + "-user");
            r?.user ? (t.user = r.user) : (t.user = Ss());
          }
          if (this.storage.isServer && t.user && !t.user.__isUserNotAvailableProxy) {
            let r = { value: this.suppressGetSessionWarning };
            ((t.user = Cm(t.user, r)), r.value && (this.suppressGetSessionWarning = !0));
          }
          return { data: { session: t }, error: null };
        }
        let { data: a, error: l } = await this._callRefreshToken(t.refresh_token);
        if (l) {
          if (!!(t.expires_at && t.expires_at * 1e3 > Date.now())) {
            let s = await ct(this.storage, this.storageKey);
            if (s && s.refresh_token === t.refresh_token)
              return this._returnResult({ data: { session: t }, error: null });
          }
          return this._returnResult({ data: { session: null }, error: l });
        }
        return this._returnResult({ data: { session: a }, error: null });
      } finally {
        this._debug("#__loadSession()", "end");
      }
    }
    async getUser(t) {
      if (t) return await this._getUser(t);
      await this.initializePromise;
      let n;
      return (
        this.lock != null
          ? (n = await this._acquireLock(this.lockAcquireTimeout, async () => await this._getUser()))
          : (n = await this._getUser()),
        n.data.user && (this.suppressGetSessionWarning = !0),
        n
      );
    }
    async _getUser(t) {
      try {
        return t
          ? await R(this.fetch, "GET", `${this.url}/user`, { headers: this.headers, jwt: t, xform: Tt })
          : await this._useSession(async (n) => {
              var i, a, l;
              let { data: r, error: s } = n;
              if (s) throw s;
              return !(!((i = r.session) === null || i === void 0) && i.access_token) &&
                !this.hasCustomAuthorizationHeader
                ? { data: { user: null }, error: new le() }
                : await R(this.fetch, "GET", `${this.url}/user`, {
                    headers: this.headers,
                    jwt:
                      (l = (a = r.session) === null || a === void 0 ? void 0 : a.access_token) !== null && l !== void 0
                        ? l
                        : void 0,
                    xform: Tt,
                  });
            });
      } catch (n) {
        if (S(n))
          return (
            si(n) && (await this._removeSession(), await re(this.storage, `${this.storageKey}-code-verifier`)),
            this._returnResult({ data: { user: null }, error: n })
          );
        throw n;
      }
    }
    async updateUser(t, n = {}) {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._updateUser(t, n))
          : await this._updateUser(t, n)
      );
    }
    async _updateUser(t, n = {}) {
      try {
        return await this._useSession(async (i) => {
          let { data: a, error: l } = i;
          if (l) throw l;
          if (!a.session) throw new le();
          let r = a.session,
            s = null,
            u = null;
          this.flowType === "pkce" && t.email != null && ([s, u] = await zn(this.storage, this.storageKey));
          let { data: o, error: f } = await R(this.fetch, "PUT", `${this.url}/user`, {
            headers: this.headers,
            redirectTo: n?.emailRedirectTo,
            body: Object.assign(Object.assign({}, t), { code_challenge: s, code_challenge_method: u }),
            jwt: r.access_token,
            xform: Tt,
          });
          if (f) throw f;
          return (
            (r.user = o.user),
            await this._saveSession(r),
            await this._notifyAllSubscribers("USER_UPDATED", r),
            this._returnResult({ data: { user: r.user }, error: null })
          );
        });
      } catch (i) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(i)))
          return this._returnResult({ data: { user: null }, error: i });
        throw i;
      }
    }
    async setSession(t) {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._setSession(t))
          : await this._setSession(t)
      );
    }
    async _setSession(t) {
      try {
        if (!t.access_token || !t.refresh_token) throw new le();
        let n = Date.now() / 1e3,
          i = n,
          a = !0,
          l = null,
          { payload: r } = xl(t.access_token);
        if ((r.exp && ((i = r.exp), (a = i <= n)), a)) {
          let { data: s, error: u } = await this._callRefreshToken(t.refresh_token);
          if (u) return this._returnResult({ data: { user: null, session: null }, error: u });
          if (!s) return { data: { user: null, session: null }, error: null };
          l = s;
        } else {
          let { data: s, error: u } = await this._getUser(t.access_token);
          if (u) return this._returnResult({ data: { user: null, session: null }, error: u });
          ((l = {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            user: s.user,
            token_type: "bearer",
            expires_in: i - n,
            expires_at: i,
          }),
            await this._saveSession(l),
            await this._notifyAllSubscribers("SIGNED_IN", l));
        }
        return this._returnResult({ data: { user: l.user, session: l }, error: null });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: { session: null, user: null }, error: n });
        throw n;
      }
    }
    async refreshSession(t) {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._refreshSession(t))
          : await this._refreshSession(t)
      );
    }
    async _refreshSession(t) {
      try {
        return await this._useSession(async (n) => {
          var i;
          if (!t) {
            let { data: r, error: s } = n;
            if (s) throw s;
            t = (i = r.session) !== null && i !== void 0 ? i : void 0;
          }
          if (!t?.refresh_token) throw new le();
          let { data: a, error: l } = await this._callRefreshToken(t.refresh_token);
          return l
            ? this._returnResult({ data: { user: null, session: null }, error: l })
            : a
              ? this._returnResult({ data: { user: a.user, session: a }, error: null })
              : this._returnResult({ data: { user: null, session: null }, error: null });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: { user: null, session: null }, error: n });
        throw n;
      }
    }
    async _getSessionFromURL(t, n) {
      var i;
      try {
        if (!_e()) throw new ri("No browser detected.");
        if (t.error || t.error_description || t.error_code)
          throw new ri(t.error_description || "Error in URL with unspecified error_description", {
            error: t.error || "unspecified_error",
            code: t.error_code || "unspecified_code",
          });
        switch (n) {
          case "implicit":
            if (this.flowType === "pkce") throw new Al("Not a valid PKCE flow url.");
            break;
          case "pkce":
            if (this.flowType === "implicit") throw new ri("Not a valid implicit grant flow url.");
            break;
          default:
        }
        if (n === "pkce") {
          if ((this._debug("#_initialize()", "begin", "is PKCE flow", !0), !t.code)) throw new Al("No code detected.");
          let { data: h, error: v } = await this._exchangeCodeForSession(t.code);
          if (v) throw v;
          let E = new URL(window.location.href);
          return (
            E.searchParams.delete("code"),
            window.history.replaceState(window.history.state, "", E.toString()),
            {
              data: { session: h.session, redirectType: (i = h.redirectType) !== null && i !== void 0 ? i : null },
              error: null,
            }
          );
        }
        let {
          provider_token: a,
          provider_refresh_token: l,
          access_token: r,
          refresh_token: s,
          expires_in: u,
          expires_at: o,
          token_type: f,
        } = t;
        if (!r || !u || !s || !f) throw new ri("No session defined in URL");
        let m = Math.round(Date.now() / 1e3),
          d = parseInt(u),
          g = m + d;
        o && (g = parseInt(o));
        let _ = g - m;
        _ * 1e3 <= At &&
          console.warn(
            `@supabase/gotrue-js: Session as retrieved from URL expires in ${_}s, should have been closer to ${d}s`,
          );
        let b = g - d;
        m - b >= 120
          ? console.warn(
              "@supabase/gotrue-js: Session as retrieved from URL was issued over 120s ago, URL could be stale",
              b,
              g,
              m,
            )
          : m - b < 0 &&
            console.warn(
              "@supabase/gotrue-js: Session as retrieved from URL was issued in the future? Check the device clock for skew",
              b,
              g,
              m,
            );
        let { data: A, error: y } = await this._getUser(r);
        if (y) throw y;
        let c = {
          provider_token: a,
          provider_refresh_token: l,
          access_token: r,
          expires_in: d,
          expires_at: g,
          refresh_token: s,
          token_type: f,
          user: A.user,
        };
        return (
          (window.location.hash = ""),
          this._debug("#_getSessionFromURL()", "clearing window.location.hash"),
          this._returnResult({ data: { session: c, redirectType: t.type }, error: null })
        );
      } catch (a) {
        if (S(a)) return this._returnResult({ data: { session: null, redirectType: null }, error: a });
        throw a;
      }
    }
    _isImplicitGrantCallback(t) {
      return typeof this.detectSessionInUrl == "function"
        ? this.detectSessionInUrl(new URL(window.location.href), t)
        : !!(t.access_token || t.error || t.error_description || t.error_code);
    }
    async _isPKCECallback(t) {
      let n = await ct(this.storage, `${this.storageKey}-code-verifier`);
      return !!(t.code && n);
    }
    async signOut(t = { scope: "global" }) {
      return (
        await this.initializePromise,
        this.lock != null
          ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._signOut(t))
          : await this._signOut(t)
      );
    }
    async _signOut({ scope: t } = { scope: "global" }) {
      return await this._useSession(async (n) => {
        var i;
        let { data: a, error: l } = n;
        if (l && !si(l)) return this._returnResult({ error: l });
        let r = (i = a.session) === null || i === void 0 ? void 0 : i.access_token;
        if (r) {
          let { error: s } = await this.admin.signOut(r, t);
          if (s && !((gm(s) && (s.status === 404 || s.status === 401 || s.status === 403)) || si(s)))
            return this._returnResult({ error: s });
        }
        return (
          t !== "others" && (await this._removeSession(), await re(this.storage, `${this.storageKey}-code-verifier`)),
          this._returnResult({ error: null })
        );
      });
    }
    onAuthStateChange(t) {
      let n = Sm(),
        i = {
          id: n,
          callback: t,
          unsubscribe: () => {
            (this._debug("#unsubscribe()", "state change callback with id removed", n),
              this.stateChangeEmitters.delete(n));
          },
        };
      return (
        this._debug("#onAuthStateChange()", "registered callback with id", n),
        this.stateChangeEmitters.set(n, i),
        (async () => (
          await this.initializePromise,
          this.lock != null
            ? await this._acquireLock(this.lockAcquireTimeout, async () => {
                this._emitInitialSession(n);
              })
            : await this._emitInitialSession(n)
        ))(),
        { data: { subscription: i } }
      );
    }
    async _emitInitialSession(t) {
      return await this._useSession(async (n) => {
        var i, a;
        try {
          let {
            data: { session: l },
            error: r,
          } = n;
          if (r) throw r;
          (await ((i = this.stateChangeEmitters.get(t)) === null || i === void 0
            ? void 0
            : i.callback("INITIAL_SESSION", l)),
            this._debug("INITIAL_SESSION", "callback id", t, "session", l));
        } catch (l) {
          (await ((a = this.stateChangeEmitters.get(t)) === null || a === void 0
            ? void 0
            : a.callback("INITIAL_SESSION", null)),
            this._debug("INITIAL_SESSION", "callback id", t, "error", l),
            si(l) ? console.warn(l) : console.error(l));
        }
      });
    }
    async resetPasswordForEmail(t, n = {}) {
      let i = null,
        a = null;
      this.flowType === "pkce" && ([i, a] = await zn(this.storage, this.storageKey, !0));
      try {
        return await R(this.fetch, "POST", `${this.url}/recover`, {
          body: {
            email: t,
            code_challenge: i,
            code_challenge_method: a,
            gotrue_meta_security: { captcha_token: n.captchaToken },
          },
          headers: this.headers,
          redirectTo: n.redirectTo,
        });
      } catch (l) {
        if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(l)))
          return this._returnResult({ data: null, error: l });
        throw l;
      }
    }
    async getUserIdentities() {
      var t;
      try {
        let { data: n, error: i } = await this.getUser();
        if (i) throw i;
        return this._returnResult({
          data: { identities: (t = n.user.identities) !== null && t !== void 0 ? t : [] },
          error: null,
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async linkIdentity(t) {
      return "token" in t ? this.linkIdentityIdToken(t) : this.linkIdentityOAuth(t);
    }
    async linkIdentityOAuth(t) {
      var n;
      try {
        let { data: i, error: a } = await this._useSession(async (l) => {
          var r, s, u, o, f;
          let { data: m, error: d } = l;
          if (d) throw d;
          let g = await this._getUrlForProvider(`${this.url}/user/identities/authorize`, t.provider, {
            redirectTo: (r = t.options) === null || r === void 0 ? void 0 : r.redirectTo,
            scopes: (s = t.options) === null || s === void 0 ? void 0 : s.scopes,
            queryParams: (u = t.options) === null || u === void 0 ? void 0 : u.queryParams,
            skipBrowserRedirect: !0,
          });
          return await R(this.fetch, "GET", g, {
            headers: this.headers,
            jwt:
              (f = (o = m.session) === null || o === void 0 ? void 0 : o.access_token) !== null && f !== void 0
                ? f
                : void 0,
          });
        });
        if (a) throw a;
        return (
          _e() &&
            !(!((n = t.options) === null || n === void 0) && n.skipBrowserRedirect) &&
            window.location.assign(i?.url),
          this._returnResult({ data: { provider: t.provider, url: i?.url }, error: null })
        );
      } catch (i) {
        if (S(i)) return this._returnResult({ data: { provider: t.provider, url: null }, error: i });
        throw i;
      }
    }
    async linkIdentityIdToken(t) {
      return await this._useSession(async (n) => {
        var i;
        try {
          let {
            error: a,
            data: { session: l },
          } = n;
          if (a) throw a;
          let { options: r, provider: s, token: u, access_token: o, nonce: f } = t,
            m = await R(this.fetch, "POST", `${this.url}/token?grant_type=id_token`, {
              headers: this.headers,
              jwt: (i = l?.access_token) !== null && i !== void 0 ? i : void 0,
              body: {
                provider: s,
                id_token: u,
                access_token: o,
                nonce: f,
                link_identity: !0,
                gotrue_meta_security: { captcha_token: r?.captchaToken },
              },
              xform: We,
            }),
            { data: d, error: g } = m;
          return g
            ? this._returnResult({ data: { user: null, session: null }, error: g })
            : !d || !d.session || !d.user
              ? this._returnResult({ data: { user: null, session: null }, error: new Zt() })
              : (d.session &&
                  (await this._saveSession(d.session), await this._notifyAllSubscribers("USER_UPDATED", d.session)),
                this._returnResult({ data: d, error: g }));
        } catch (a) {
          if ((await re(this.storage, `${this.storageKey}-code-verifier`), S(a)))
            return this._returnResult({ data: { user: null, session: null }, error: a });
          throw a;
        }
      });
    }
    async unlinkIdentity(t) {
      try {
        return await this._useSession(async (n) => {
          var i, a;
          let { data: l, error: r } = n;
          if (r) throw r;
          return await R(this.fetch, "DELETE", `${this.url}/user/identities/${t.identity_id}`, {
            headers: this.headers,
            jwt:
              (a = (i = l.session) === null || i === void 0 ? void 0 : i.access_token) !== null && a !== void 0
                ? a
                : void 0,
          });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _refreshAccessToken(t) {
      let n = "#_refreshAccessToken()";
      this._debug(n, "begin");
      try {
        let i = Date.now();
        return await Tm(
          async (a) => (
            a > 0 && (await Rm(200 * Math.pow(2, a - 1))),
            this._debug(n, "refreshing attempt", a),
            await R(this.fetch, "POST", `${this.url}/token?grant_type=refresh_token`, {
              body: { refresh_token: t },
              headers: this.headers,
              xform: We,
            })
          ),
          (a, l) => {
            let r = 200 * Math.pow(2, a);
            return l && Nc(l) && Date.now() + r - i < At;
          },
        );
      } catch (i) {
        if ((this._debug(n, "error", i), S(i)))
          return this._returnResult({ data: { session: null, user: null }, error: i });
        throw i;
      } finally {
        this._debug(n, "end");
      }
    }
    _isValidSession(t) {
      return typeof t == "object" && t !== null && "access_token" in t && "refresh_token" in t && "expires_at" in t;
    }
    async _handleProviderSignIn(t, n) {
      let i = await this._getUrlForProvider(`${this.url}/authorize`, t, {
        redirectTo: n.redirectTo,
        scopes: n.scopes,
        queryParams: n.queryParams,
      });
      return (
        this._debug("#_handleProviderSignIn()", "provider", t, "options", n, "url", i),
        _e() && !n.skipBrowserRedirect && window.location.assign(i),
        { data: { provider: t, url: i }, error: null }
      );
    }
    async _recoverAndRefresh() {
      var t, n;
      let i = "#_recoverAndRefresh()";
      this._debug(i, "begin");
      try {
        let a = await ct(this.storage, this.storageKey);
        if (a && this.userStorage) {
          let r = await ct(this.userStorage, this.storageKey + "-user");
          (!this.storage.isServer &&
            Object.is(this.storage, this.userStorage) &&
            !r &&
            ((r = { user: a.user }), await oi(this.userStorage, this.storageKey + "-user", r)),
            (a.user = (t = r?.user) !== null && t !== void 0 ? t : Ss()));
        } else if (a && !a.user && !a.user) {
          let r = await ct(this.storage, this.storageKey + "-user");
          r && r?.user
            ? ((a.user = r.user),
              await re(this.storage, this.storageKey + "-user"),
              await oi(this.storage, this.storageKey, a))
            : (a.user = Ss());
        }
        if ((this._debug(i, "session from storage", a), !this._isValidSession(a))) {
          (this._debug(i, "session is not valid"), a !== null && (await this._removeSession()));
          return;
        }
        let l = ((n = a.expires_at) !== null && n !== void 0 ? n : 1 / 0) * 1e3 - Date.now() < ms;
        if ((this._debug(i, `session has${l ? "" : " not"} expired with margin of ${ms}s`), l)) {
          if (this.autoRefreshToken && a.refresh_token) {
            let { error: r } = await this._callRefreshToken(a.refresh_token);
            r && (mm(r) ? this._debug(i, "refresh discarded by commit guard", r) : this._debug(i, "refresh failed", r));
          }
        } else if (a.user && a.user.__isUserNotAvailableProxy === !0)
          try {
            let { data: r, error: s } = await this._getUser(a.access_token);
            !s && r?.user
              ? ((a.user = r.user), await this._saveSession(a), await this._notifyAllSubscribers("SIGNED_IN", a))
              : this._debug(i, "could not get user data, skipping SIGNED_IN notification");
          } catch (r) {
            (console.error("Error getting user data:", r),
              this._debug(i, "error getting user data, skipping SIGNED_IN notification", r));
          }
        else await this._notifyAllSubscribers("SIGNED_IN", a);
      } catch (a) {
        (this._debug(i, "error", a), console.error(a));
        return;
      } finally {
        this._debug(i, "end");
      }
    }
    async _callRefreshToken(t) {
      var n, i;
      if (!t) throw new le();
      if (this.refreshingDeferred) return this.refreshingDeferred.promise;
      if (
        this.lastRefreshFailure &&
        this.lastRefreshFailure.refreshToken === t &&
        Date.now() < this.lastRefreshFailure.expiresAt
      )
        return (
          this._debug("#_callRefreshToken()", "returning cached failure (cooldown active)"),
          this.lastRefreshFailure.result
        );
      let a = "#_callRefreshToken()";
      this._debug(a, "begin");
      try {
        this.refreshingDeferred = new Ol();
        let l = await ct(this.storage, this.storageKey),
          { data: r, error: s } = await this._refreshAccessToken(t);
        if (s) throw s;
        if (!r.session) throw new le();
        let u = await ct(this.storage, this.storageKey);
        if (l !== null && (u === null || u.refresh_token !== l.refresh_token)) {
          this._debug(a, "commit guard: storage changed since refresh started, discarding rotated tokens", {
            startedWith: "present",
            nowHolds: u ? "replaced" : "cleared",
          });
          let d = { data: null, error: new Rl() };
          return (this.refreshingDeferred.resolve(d), d);
        }
        let f = this._sessionRemovalEpoch;
        if ((await this._saveSession(r.session), this._sessionRemovalEpoch !== f)) {
          (this._debug(a, "commit guard (post-save): _removeSession ran during _saveSession, undoing write"),
            await re(this.storage, this.storageKey),
            this.userStorage && (await re(this.userStorage, this.storageKey + "-user")));
          let d = { data: null, error: new Rl() };
          return (this.refreshingDeferred.resolve(d), d);
        }
        await this._notifyAllSubscribers("TOKEN_REFRESHED", r.session);
        let m = { data: r.session, error: null };
        return ((this.lastRefreshFailure = null), this.refreshingDeferred.resolve(m), m);
      } catch (l) {
        if ((this._debug(a, "error", l), S(l))) {
          let r = { data: null, error: l };
          if (!Nc(l)) {
            let s = await ct(this.storage, this.storageKey);
            !!(s?.expires_at && s.expires_at * 1e3 > Date.now())
              ? this._debug(a, "proactive refresh failed, access token still valid \u2014 preserving session")
              : await this._removeSession();
          }
          return (
            (this.lastRefreshFailure = { refreshToken: t, result: r, expiresAt: Date.now() + um }),
            (n = this.refreshingDeferred) === null || n === void 0 || n.resolve(r),
            r
          );
        }
        throw ((i = this.refreshingDeferred) === null || i === void 0 || i.reject(l), l);
      } finally {
        ((this.refreshingDeferred = null), this._debug(a, "end"));
      }
    }
    async _notifyAllSubscribers(t, n, i = !0) {
      let a = `#_notifyAllSubscribers(${t})`;
      this._debug(a, "begin", n, `broadcast = ${i}`);
      try {
        this.broadcastChannel && i && this.broadcastChannel.postMessage({ event: t, session: n });
        let l = [],
          r = Array.from(this.stateChangeEmitters.values()).map(async (s) => {
            try {
              await s.callback(t, n);
            } catch (u) {
              l.push(u);
            }
          });
        if ((await Promise.all(r), l.length > 0)) {
          for (let s = 0; s < l.length; s += 1) console.error(l[s]);
          throw l[0];
        }
      } finally {
        this._debug(a, "end");
      }
    }
    async _saveSession(t) {
      (this._debug("#_saveSession()", t),
        (this.suppressGetSessionWarning = !0),
        await re(this.storage, `${this.storageKey}-code-verifier`));
      let n = Object.assign({}, t),
        i = n.user && n.user.__isUserNotAvailableProxy === !0;
      if (this.userStorage) {
        !i && n.user && (await oi(this.userStorage, this.storageKey + "-user", { user: n.user }));
        let a = Object.assign({}, n);
        delete a.user;
        let l = zc(a);
        await oi(this.storage, this.storageKey, l);
      } else {
        let a = zc(n);
        await oi(this.storage, this.storageKey, a);
      }
    }
    async _removeSession() {
      ((this._sessionRemovalEpoch += 1),
        this._debug("#_removeSession()"),
        (this.lastRefreshFailure = null),
        (this.suppressGetSessionWarning = !1),
        await re(this.storage, this.storageKey),
        await re(this.storage, this.storageKey + "-code-verifier"),
        await re(this.storage, this.storageKey + "-user"),
        this.userStorage && (await re(this.userStorage, this.storageKey + "-user")),
        await this._notifyAllSubscribers("SIGNED_OUT", null));
    }
    _removeVisibilityChangedCallback() {
      this._debug("#_removeVisibilityChangedCallback()");
      let t = this.visibilityChangedCallback;
      this.visibilityChangedCallback = null;
      try {
        t && _e() && window?.removeEventListener && window.removeEventListener("visibilitychange", t);
      } catch (n) {
        console.error("removing visibilitychange callback failed", n);
      }
    }
    async _startAutoRefresh() {
      (await this._stopAutoRefresh(), this._debug("#_startAutoRefresh()"));
      let t = setInterval(() => this._autoRefreshTokenTick(), At);
      ((this.autoRefreshTicker = t),
        t && typeof t == "object" && typeof t.unref == "function"
          ? t.unref()
          : typeof Deno < "u" && typeof Deno.unrefTimer == "function" && Deno.unrefTimer(t));
      let n = setTimeout(async () => {
        (await this.initializePromise, await this._autoRefreshTokenTick());
      }, 0);
      ((this.autoRefreshTickTimeout = n),
        n && typeof n == "object" && typeof n.unref == "function"
          ? n.unref()
          : typeof Deno < "u" && typeof Deno.unrefTimer == "function" && Deno.unrefTimer(n));
    }
    async _stopAutoRefresh() {
      this._debug("#_stopAutoRefresh()");
      let t = this.autoRefreshTicker;
      ((this.autoRefreshTicker = null), t && clearInterval(t));
      let n = this.autoRefreshTickTimeout;
      ((this.autoRefreshTickTimeout = null), n && clearTimeout(n));
    }
    async startAutoRefresh() {
      (this._removeVisibilityChangedCallback(), await this._startAutoRefresh());
    }
    async stopAutoRefresh() {
      (this._removeVisibilityChangedCallback(), await this._stopAutoRefresh());
    }
    async dispose() {
      var t;
      (this._removeVisibilityChangedCallback(),
        await this._stopAutoRefresh(),
        (t = this.broadcastChannel) === null || t === void 0 || t.close(),
        (this.broadcastChannel = null),
        this.stateChangeEmitters.clear());
    }
    async _autoRefreshTokenTick() {
      if ((this._debug("#_autoRefreshTokenTick()", "begin"), this.lock != null)) {
        try {
          await this._acquireLock(0, async () => {
            try {
              let t = Date.now();
              try {
                return await this._useSession(async (n) => {
                  let {
                    data: { session: i },
                  } = n;
                  if (!i || !i.refresh_token || !i.expires_at) {
                    this._debug("#_autoRefreshTokenTick()", "no session");
                    return;
                  }
                  let a = Math.floor((i.expires_at * 1e3 - t) / At);
                  (this._debug(
                    "#_autoRefreshTokenTick()",
                    `access token expires in ${a} ticks, a tick lasts ${At}ms, refresh threshold is ${fa} ticks`,
                  ),
                    a <= fa && (await this._callRefreshToken(i.refresh_token)));
                });
              } catch (n) {
                console.error("Auto refresh tick failed with error. This is likely a transient error.", n);
              }
            } finally {
              this._debug("#_autoRefreshTokenTick()", "end");
            }
          });
        } catch (t) {
          if (t instanceof As) this._debug("auto refresh token tick lock not available");
          else throw t;
        }
        return;
      }
      if (this.refreshingDeferred !== null) {
        this._debug("#_autoRefreshTokenTick()", "refresh already in flight, skipping");
        return;
      }
      try {
        let t = Date.now();
        try {
          await this._useSession(async (n) => {
            let {
              data: { session: i },
            } = n;
            if (!i || !i.refresh_token || !i.expires_at) {
              this._debug("#_autoRefreshTokenTick()", "no session");
              return;
            }
            let a = Math.floor((i.expires_at * 1e3 - t) / At);
            (this._debug(
              "#_autoRefreshTokenTick()",
              `access token expires in ${a} ticks, a tick lasts ${At}ms, refresh threshold is ${fa} ticks`,
            ),
              a <= fa && (await this._callRefreshToken(i.refresh_token)));
          });
        } catch (n) {
          console.error("Auto refresh tick failed with error. This is likely a transient error.", n);
        }
      } finally {
        this._debug("#_autoRefreshTokenTick()", "end");
      }
    }
    async _handleVisibilityChange() {
      if ((this._debug("#_handleVisibilityChange()"), !_e() || !window?.addEventListener))
        return (this.autoRefreshToken && this.startAutoRefresh(), !1);
      try {
        ((this.visibilityChangedCallback = async () => {
          try {
            await this._onVisibilityChanged(!1);
          } catch (t) {
            this._debug("#visibilityChangedCallback", "error", t);
          }
        }),
          window?.addEventListener("visibilitychange", this.visibilityChangedCallback),
          await this._onVisibilityChanged(!0));
      } catch (t) {
        console.error("_handleVisibilityChange", t);
      }
    }
    async _onVisibilityChanged(t) {
      let n = `#_onVisibilityChanged(${t})`;
      if ((this._debug(n, "visibilityState", document.visibilityState), document.visibilityState === "visible")) {
        if ((this.autoRefreshToken && this._startAutoRefresh(), !t))
          if ((await this.initializePromise, this.lock != null))
            await this._acquireLock(this.lockAcquireTimeout, async () => {
              if (document.visibilityState !== "visible") {
                this._debug(
                  n,
                  "acquired the lock to recover the session, but the browser visibilityState is no longer visible, aborting",
                );
                return;
              }
              await this._recoverAndRefresh();
            });
          else {
            if (document.visibilityState !== "visible") {
              this._debug(n, "visibilityState is no longer visible, skipping recovery");
              return;
            }
            await this._recoverAndRefresh();
          }
      } else document.visibilityState === "hidden" && this.autoRefreshToken && this._stopAutoRefresh();
    }
    async _getUrlForProvider(t, n, i) {
      let a = [`provider=${encodeURIComponent(n)}`];
      if (
        (i?.redirectTo && a.push(`redirect_to=${encodeURIComponent(i.redirectTo)}`),
        i?.scopes && a.push(`scopes=${encodeURIComponent(i.scopes)}`),
        this.flowType === "pkce")
      ) {
        let [l, r] = await zn(this.storage, this.storageKey),
          s = new URLSearchParams({
            code_challenge: `${encodeURIComponent(l)}`,
            code_challenge_method: `${encodeURIComponent(r)}`,
          });
        a.push(s.toString());
      }
      if (i?.queryParams) {
        let l = new URLSearchParams(i.queryParams);
        a.push(l.toString());
      }
      return (i?.skipBrowserRedirect && a.push(`skip_http_redirect=${i.skipBrowserRedirect}`), `${t}?${a.join("&")}`);
    }
    async _unenroll(t) {
      try {
        return await this._useSession(async (n) => {
          var i;
          let { data: a, error: l } = n;
          return l
            ? this._returnResult({ data: null, error: l })
            : await R(this.fetch, "DELETE", `${this.url}/factors/${t.factorId}`, {
                headers: this.headers,
                jwt: (i = a?.session) === null || i === void 0 ? void 0 : i.access_token,
              });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _enroll(t) {
      try {
        return await this._useSession(async (n) => {
          var i, a;
          let { data: l, error: r } = n;
          if (r) return this._returnResult({ data: null, error: r });
          let s = Object.assign(
              { friendly_name: t.friendlyName, factor_type: t.factorType },
              t.factorType === "phone" ? { phone: t.phone } : t.factorType === "totp" ? { issuer: t.issuer } : {},
            ),
            { data: u, error: o } = await R(this.fetch, "POST", `${this.url}/factors`, {
              body: s,
              headers: this.headers,
              jwt: (i = l?.session) === null || i === void 0 ? void 0 : i.access_token,
            });
          return o
            ? this._returnResult({ data: null, error: o })
            : (t.factorType === "totp" &&
                u.type === "totp" &&
                !((a = u?.totp) === null || a === void 0) &&
                a.qr_code &&
                (u.totp.qr_code = `data:image/svg+xml;utf-8,${u.totp.qr_code}`),
              this._returnResult({ data: u, error: null }));
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _verify(t) {
      let n = async () => {
        try {
          return await this._useSession(async (i) => {
            var a;
            let { data: l, error: r } = i;
            if (r) return this._returnResult({ data: null, error: r });
            let s = Object.assign(
                { challenge_id: t.challengeId },
                "webauthn" in t
                  ? {
                      webauthn: Object.assign(Object.assign({}, t.webauthn), {
                        credential_response:
                          t.webauthn.type === "create"
                            ? Yc(t.webauthn.credential_response)
                            : Ic(t.webauthn.credential_response),
                      }),
                    }
                  : { code: t.code },
              ),
              { data: u, error: o } = await R(this.fetch, "POST", `${this.url}/factors/${t.factorId}/verify`, {
                body: s,
                headers: this.headers,
                jwt: (a = l?.session) === null || a === void 0 ? void 0 : a.access_token,
              });
            return o
              ? this._returnResult({ data: null, error: o })
              : (await this._saveSession(Object.assign({ expires_at: Math.round(Date.now() / 1e3) + u.expires_in }, u)),
                await this._notifyAllSubscribers("MFA_CHALLENGE_VERIFIED", u),
                this._returnResult({ data: u, error: o }));
          });
        } catch (i) {
          if (S(i)) return this._returnResult({ data: null, error: i });
          throw i;
        }
      };
      return this.lock != null ? this._acquireLock(this.lockAcquireTimeout, n) : n();
    }
    async _challenge(t) {
      let n = async () => {
        try {
          return await this._useSession(async (i) => {
            var a;
            let { data: l, error: r } = i;
            if (r) return this._returnResult({ data: null, error: r });
            let s = await R(this.fetch, "POST", `${this.url}/factors/${t.factorId}/challenge`, {
              body: t,
              headers: this.headers,
              jwt: (a = l?.session) === null || a === void 0 ? void 0 : a.access_token,
            });
            if (s.error) return s;
            let { data: u } = s;
            if (u.type !== "webauthn") return { data: u, error: null };
            switch (u.webauthn.type) {
              case "create":
                return {
                  data: Object.assign(Object.assign({}, u), {
                    webauthn: Object.assign(Object.assign({}, u.webauthn), {
                      credential_options: Object.assign(Object.assign({}, u.webauthn.credential_options), {
                        publicKey: Gc(u.webauthn.credential_options.publicKey),
                      }),
                    }),
                  }),
                  error: null,
                };
              case "request":
                return {
                  data: Object.assign(Object.assign({}, u), {
                    webauthn: Object.assign(Object.assign({}, u.webauthn), {
                      credential_options: Object.assign(Object.assign({}, u.webauthn.credential_options), {
                        publicKey: Kc(u.webauthn.credential_options.publicKey),
                      }),
                    }),
                  }),
                  error: null,
                };
            }
          });
        } catch (i) {
          if (S(i)) return this._returnResult({ data: null, error: i });
          throw i;
        }
      };
      return this.lock != null ? this._acquireLock(this.lockAcquireTimeout, n) : n();
    }
    async _challengeAndVerify(t) {
      let { data: n, error: i } = await this._challenge({ factorId: t.factorId });
      return i
        ? this._returnResult({ data: null, error: i })
        : await this._verify({ factorId: t.factorId, challengeId: n.id, code: t.code });
    }
    async _listFactors() {
      var t;
      let {
        data: { user: n },
        error: i,
      } = await this.getUser();
      if (i) return { data: null, error: i };
      let a = { all: [], phone: [], totp: [], webauthn: [] };
      for (let l of (t = n?.factors) !== null && t !== void 0 ? t : [])
        (a.all.push(l), l.status === "verified" && a[l.factor_type].push(l));
      return { data: a, error: null };
    }
    async _getAuthenticatorAssuranceLevel(t) {
      var n, i, a, l;
      if (t)
        try {
          let { payload: g } = xl(t),
            _ = null;
          g.aal && (_ = g.aal);
          let b = _,
            {
              data: { user: A },
              error: y,
            } = await this.getUser(t);
          if (y) return this._returnResult({ data: null, error: y });
          ((i = (n = A?.factors) === null || n === void 0 ? void 0 : n.filter((v) => v.status === "verified")) !==
            null && i !== void 0
            ? i
            : []
          ).length > 0 && (b = "aal2");
          let h = g.amr || [];
          return { data: { currentLevel: _, nextLevel: b, currentAuthenticationMethods: h }, error: null };
        } catch (g) {
          if (S(g)) return this._returnResult({ data: null, error: g });
          throw g;
        }
      let {
        data: { session: r },
        error: s,
      } = await this.getSession();
      if (s) return this._returnResult({ data: null, error: s });
      if (!r) return { data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] }, error: null };
      let { payload: u } = xl(r.access_token),
        o = null;
      u.aal && (o = u.aal);
      let f = o;
      ((l = (a = r.user.factors) === null || a === void 0 ? void 0 : a.filter((g) => g.status === "verified")) !==
        null && l !== void 0
        ? l
        : []
      ).length > 0 && (f = "aal2");
      let d = u.amr || [];
      return { data: { currentLevel: o, nextLevel: f, currentAuthenticationMethods: d }, error: null };
    }
    async _getAuthorizationDetails(t) {
      try {
        return await this._useSession(async (n) => {
          let {
            data: { session: i },
            error: a,
          } = n;
          return a
            ? this._returnResult({ data: null, error: a })
            : i
              ? await R(this.fetch, "GET", `${this.url}/oauth/authorizations/${t}`, {
                  headers: this.headers,
                  jwt: i.access_token,
                  xform: (l) => ({ data: l, error: null }),
                })
              : this._returnResult({ data: null, error: new le() });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _approveAuthorization(t, n) {
      try {
        return await this._useSession(async (i) => {
          let {
            data: { session: a },
            error: l,
          } = i;
          if (l) return this._returnResult({ data: null, error: l });
          if (!a) return this._returnResult({ data: null, error: new le() });
          let r = await R(this.fetch, "POST", `${this.url}/oauth/authorizations/${t}/consent`, {
            headers: this.headers,
            jwt: a.access_token,
            body: { action: "approve" },
            xform: (s) => ({ data: s, error: null }),
          });
          return (
            r.data &&
              r.data.redirect_url &&
              _e() &&
              !n?.skipBrowserRedirect &&
              window.location.assign(r.data.redirect_url),
            r
          );
        });
      } catch (i) {
        if (S(i)) return this._returnResult({ data: null, error: i });
        throw i;
      }
    }
    async _denyAuthorization(t, n) {
      try {
        return await this._useSession(async (i) => {
          let {
            data: { session: a },
            error: l,
          } = i;
          if (l) return this._returnResult({ data: null, error: l });
          if (!a) return this._returnResult({ data: null, error: new le() });
          let r = await R(this.fetch, "POST", `${this.url}/oauth/authorizations/${t}/consent`, {
            headers: this.headers,
            jwt: a.access_token,
            body: { action: "deny" },
            xform: (s) => ({ data: s, error: null }),
          });
          return (
            r.data &&
              r.data.redirect_url &&
              _e() &&
              !n?.skipBrowserRedirect &&
              window.location.assign(r.data.redirect_url),
            r
          );
        });
      } catch (i) {
        if (S(i)) return this._returnResult({ data: null, error: i });
        throw i;
      }
    }
    async _listOAuthGrants() {
      try {
        return await this._useSession(async (t) => {
          let {
            data: { session: n },
            error: i,
          } = t;
          return i
            ? this._returnResult({ data: null, error: i })
            : n
              ? await R(this.fetch, "GET", `${this.url}/user/oauth/grants`, {
                  headers: this.headers,
                  jwt: n.access_token,
                  xform: (a) => ({ data: a, error: null }),
                })
              : this._returnResult({ data: null, error: new le() });
        });
      } catch (t) {
        if (S(t)) return this._returnResult({ data: null, error: t });
        throw t;
      }
    }
    async _revokeOAuthGrant(t) {
      try {
        return await this._useSession(async (n) => {
          let {
            data: { session: i },
            error: a,
          } = n;
          return a
            ? this._returnResult({ data: null, error: a })
            : i
              ? (await R(this.fetch, "DELETE", `${this.url}/user/oauth/grants`, {
                  headers: this.headers,
                  jwt: i.access_token,
                  query: { client_id: t.clientId },
                  noResolveJson: !0,
                }),
                { data: {}, error: null })
              : this._returnResult({ data: null, error: new le() });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async fetchJwk(t, n = { keys: [] }) {
      let i = n.keys.find((s) => s.kid === t);
      if (i) return i;
      let a = Date.now();
      if (((i = this.jwks.keys.find((s) => s.kid === t)), i && this.jwks_cached_at + hm > a)) return i;
      let { data: l, error: r } = await R(this.fetch, "GET", `${this.url}/.well-known/jwks.json`, {
        headers: this.headers,
      });
      if (r) throw r;
      return !l.keys ||
        l.keys.length === 0 ||
        ((this.jwks = l), (this.jwks_cached_at = a), (i = l.keys.find((s) => s.kid === t)), !i)
        ? null
        : i;
    }
    async getClaims(t, n = {}) {
      try {
        let i = t;
        if (!i) {
          let { data: g, error: _ } = await this.getSession();
          if (_ || !g.session) return this._returnResult({ data: null, error: _ });
          i = g.session.access_token;
        }
        let {
          header: a,
          payload: l,
          signature: r,
          raw: { header: s, payload: u },
        } = xl(i);
        if (!n?.allowExpired)
          try {
            xm(l.exp);
          } catch (g) {
            throw new Nn(g instanceof Error ? g.message : "JWT validation failed");
          }
        let o =
          !a.alg || a.alg.startsWith("HS") || !a.kid || !("crypto" in globalThis && "subtle" in globalThis.crypto)
            ? null
            : await this.fetchJwk(a.kid, n?.keys ? { keys: n.keys } : n?.jwks);
        if (!o) {
          let { error: g } = await this.getUser(i);
          if (g) throw g;
          return { data: { claims: l, header: a, signature: r }, error: null };
        }
        let f = km(a.alg),
          m = await crypto.subtle.importKey("jwk", o, f, !0, ["verify"]);
        if (!(await crypto.subtle.verify(f, m, r, bm(`${s}.${u}`)))) throw new Nn("Invalid JWT signature");
        return { data: { claims: l, header: a, signature: r }, error: null };
      } catch (i) {
        if (S(i)) return this._returnResult({ data: null, error: i });
        throw i;
      }
    }
    async signInWithPasskey(t) {
      var n, i, a;
      $e(this.experimental);
      try {
        if (!kl()) return this._returnResult({ data: null, error: new Oe("Browser does not support WebAuthn", null) });
        let { data: l, error: r } = await this._startPasskeyAuthentication({
          options: { captchaToken: (n = t?.options) === null || n === void 0 ? void 0 : n.captchaToken },
        });
        if (r || !l) return this._returnResult({ data: null, error: r });
        let s = Kc(l.options),
          u =
            (a = (i = t?.options) === null || i === void 0 ? void 0 : i.signal) !== null && a !== void 0
              ? a
              : Os.createNewAbortSignal(),
          { data: o, error: f } = await Xc({ publicKey: s, signal: u });
        if (f || !o) return this._returnResult({ data: null, error: f ?? new Oe("WebAuthn ceremony failed", null) });
        let m = Ic(o);
        return this._verifyPasskeyAuthentication({ challengeId: l.challenge_id, credential: m });
      } catch (l) {
        if (S(l)) return this._returnResult({ data: null, error: l });
        throw l;
      }
    }
    async registerPasskey(t) {
      var n, i;
      $e(this.experimental);
      try {
        if (!kl()) return this._returnResult({ data: null, error: new Oe("Browser does not support WebAuthn", null) });
        let { data: a, error: l } = await this._startPasskeyRegistration();
        if (l || !a) return this._returnResult({ data: null, error: l });
        let r = Gc(a.options),
          s =
            (i = (n = t?.options) === null || n === void 0 ? void 0 : n.signal) !== null && i !== void 0
              ? i
              : Os.createNewAbortSignal(),
          { data: u, error: o } = await Vc({ publicKey: r, signal: s });
        if (o || !u) return this._returnResult({ data: null, error: o ?? new Oe("WebAuthn ceremony failed", null) });
        let f = Yc(u);
        return this._verifyPasskeyRegistration({ challengeId: a.challenge_id, credential: f });
      } catch (a) {
        if (S(a)) return this._returnResult({ data: null, error: a });
        throw a;
      }
    }
    async _startPasskeyRegistration() {
      $e(this.experimental);
      try {
        return await this._useSession(async (t) => {
          let {
            data: { session: n },
            error: i,
          } = t;
          if (i) return this._returnResult({ data: null, error: i });
          if (!n) return this._returnResult({ data: null, error: new le() });
          let { data: a, error: l } = await R(this.fetch, "POST", `${this.url}/passkeys/registration/options`, {
            headers: this.headers,
            jwt: n.access_token,
            body: {},
          });
          return l ? this._returnResult({ data: null, error: l }) : this._returnResult({ data: a, error: null });
        });
      } catch (t) {
        if (S(t)) return this._returnResult({ data: null, error: t });
        throw t;
      }
    }
    async _verifyPasskeyRegistration(t) {
      $e(this.experimental);
      try {
        return await this._useSession(async (n) => {
          let {
            data: { session: i },
            error: a,
          } = n;
          if (a) return this._returnResult({ data: null, error: a });
          if (!i) return this._returnResult({ data: null, error: new le() });
          let { data: l, error: r } = await R(this.fetch, "POST", `${this.url}/passkeys/registration/verify`, {
            headers: this.headers,
            jwt: i.access_token,
            body: { challenge_id: t.challengeId, credential: t.credential },
          });
          return r ? this._returnResult({ data: null, error: r }) : this._returnResult({ data: l, error: null });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _startPasskeyAuthentication(t) {
      var n;
      $e(this.experimental);
      try {
        let { data: i, error: a } = await R(this.fetch, "POST", `${this.url}/passkeys/authentication/options`, {
          headers: this.headers,
          body: {
            gotrue_meta_security: {
              captcha_token: (n = t?.options) === null || n === void 0 ? void 0 : n.captchaToken,
            },
          },
        });
        return a ? this._returnResult({ data: null, error: a }) : this._returnResult({ data: i, error: null });
      } catch (i) {
        if (S(i)) return this._returnResult({ data: null, error: i });
        throw i;
      }
    }
    async _verifyPasskeyAuthentication(t) {
      $e(this.experimental);
      try {
        let { data: n, error: i } = await R(this.fetch, "POST", `${this.url}/passkeys/authentication/verify`, {
          headers: this.headers,
          body: { challenge_id: t.challengeId, credential: t.credential },
          xform: We,
        });
        return i
          ? this._returnResult({ data: null, error: i })
          : (n.session &&
              (await this._saveSession(n.session), await this._notifyAllSubscribers("SIGNED_IN", n.session)),
            this._returnResult({ data: n, error: null }));
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _listPasskeys() {
      $e(this.experimental);
      try {
        return await this._useSession(async (t) => {
          let {
            data: { session: n },
            error: i,
          } = t;
          if (i) return this._returnResult({ data: null, error: i });
          if (!n) return this._returnResult({ data: null, error: new le() });
          let { data: a, error: l } = await R(this.fetch, "GET", `${this.url}/passkeys`, {
            headers: this.headers,
            jwt: n.access_token,
            xform: (r) => ({ data: r, error: null }),
          });
          return l ? this._returnResult({ data: null, error: l }) : this._returnResult({ data: a, error: null });
        });
      } catch (t) {
        if (S(t)) return this._returnResult({ data: null, error: t });
        throw t;
      }
    }
    async _updatePasskey(t) {
      $e(this.experimental);
      try {
        return await this._useSession(async (n) => {
          let {
            data: { session: i },
            error: a,
          } = n;
          if (a) return this._returnResult({ data: null, error: a });
          if (!i) return this._returnResult({ data: null, error: new le() });
          let { data: l, error: r } = await R(this.fetch, "PATCH", `${this.url}/passkeys/${t.passkeyId}`, {
            headers: this.headers,
            jwt: i.access_token,
            body: { friendly_name: t.friendlyName },
          });
          return r ? this._returnResult({ data: null, error: r }) : this._returnResult({ data: l, error: null });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
    async _deletePasskey(t) {
      $e(this.experimental);
      try {
        return await this._useSession(async (n) => {
          let {
            data: { session: i },
            error: a,
          } = n;
          if (a) return this._returnResult({ data: null, error: a });
          if (!i) return this._returnResult({ data: null, error: new le() });
          let { error: l } = await R(this.fetch, "DELETE", `${this.url}/passkeys/${t.passkeyId}`, {
            headers: this.headers,
            jwt: i.access_token,
            noResolveJson: !0,
          });
          return l ? this._returnResult({ data: null, error: l }) : this._returnResult({ data: null, error: null });
        });
      } catch (n) {
        if (S(n)) return this._returnResult({ data: null, error: n });
        throw n;
      }
    }
  };
xs.nextInstanceID = {};
var Qc = xs;
var w_ = Qc,
  Jc = w_;
var hi = "owner-control-auth-v2",
  S_ = "owner-auth-flow-v2",
  ks = "owner-login-lease-v2",
  E_ = (e, t, n) => ({
    auth: new Jc({
      ...n?.auth,
      url: e + "/auth/v1",
      headers: { apikey: t, Authorization: "Bearer " + t },
      fetch: n?.global?.fetch,
    }),
  }),
  Zc = Object.freeze({
    available: !1,
    close() {},
    async transact() {
      throw new Error("Owner sign-in unavailable");
    },
  });
function A_(e, t) {
  return async (n, i) => {
    let a = new URL(typeof n == "string" ? n : n instanceof URL ? n.href : n.url),
      l = (i?.method ?? (n instanceof Request ? n.method : "GET")).toUpperCase(),
      r = [...a.searchParams];
    if (!(
      a.origin === ca &&
      !a.username &&
      !a.password &&
      !a.hash &&
      ((a.pathname === "/auth/v1/user" && l === "GET" && r.length === 0) ||
        (a.pathname === "/auth/v1/otp" &&
          l === "POST" &&
          r.length === 1 &&
          r[0][0] === "redirect_to" &&
          t !== null &&
          r[0][1] === t) ||
        (a.pathname === "/auth/v1/token" &&
          l === "POST" &&
          r.length === 1 &&
          r[0][0] === "grant_type" &&
          ["pkce", "refresh_token"].includes(r[0][1])) ||
        (a.pathname === "/auth/v1/logout" &&
          l === "POST" &&
          r.length === 1 &&
          r[0][0] === "scope" &&
          r[0][1] === "local"))
    ))
      throw new Error("Auth destination not allowed");
    return e(n, { ...i, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  };
}
function R_(e, t) {
  let n = 0;
  if (e !== null) {
    if (e.length > 256) throw new Error("Storage unavailable");
    let i = JSON.parse(e);
    if (
      !i ||
      Object.keys(i).sort().join(",") !== "generation,operationId,version" ||
      i.version !== 2 ||
      !Cn(i.operationId) ||
      !Number.isSafeInteger(i.generation) ||
      i.generation < 1 ||
      i.generation >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("Storage unavailable");
    n = i.generation;
  }
  if (!Cn(t)) throw new Error("Secure randomness unavailable");
  return { version: 2, generation: n + 1, operationId: t };
}
function Bm(e, t) {
  try {
    if (typeof e != "string" || e.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(e))
      throw new Error("Token");
    let n = atob(e.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"));
    if (n.length > 6144) throw new Error("Token");
    let i = JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(Uint8Array.from(n, (r) => r.charCodeAt(0)))),
      a = (r) => typeof r == "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r),
      l = (r) => Number.isSafeInteger(r) && r >= 0;
    if (
      !i ||
      typeof i != "object" ||
      Array.isArray(i) ||
      i.iss !== ca + "/auth/v1" ||
      i.aud !== "authenticated" ||
      !a(i.sub) ||
      !a(i.session_id) ||
      !l(i.iat) ||
      !l(i.exp) ||
      !l(t) ||
      i.iat > t ||
      i.exp <= t ||
      i.iat >= i.exp
    )
      throw new Error("Claims");
    return { nowSeconds: t, subject: i.sub, sessionId: i.session_id, tokenIat: i.iat, tokenExp: i.exp };
  } catch {
    throw new P("AUTH_REQUIRED", "not_sent");
  }
}
async function T_(e, t) {
  if (e.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new Error("JSON required");
  let n = e.headers.get("Content-Length");
  if (n !== null && (!/^\d+$/.test(n) || Number(n) > 65536)) throw new Error("Response too large");
  if (!e.body) throw new Error("Missing body");
  let i = e.body.getReader(),
    a = [],
    l = 0,
    r,
    s = new Promise((m, d) => {
      r = d;
    }),
    u = () => {
      (i.cancel().catch(() => {}), r(new Error("Body cancelled")));
    };
  (t.addEventListener("abort", u, { once: !0 }), t.aborted && u());
  try {
    for (;;) {
      let { value: m, done: d } = await Promise.race([i.read(), s]);
      if (d) break;
      if (((l += m.length), l > 65536 || a.length >= 128)) throw new Error("Response too large");
      a.push(m);
    }
  } finally {
    (t.removeEventListener("abort", u), i.cancel().catch(() => {}), i.releaseLock());
  }
  let o = new Uint8Array(l),
    f = 0;
  for (let m of a) (o.set(m, f), (f += m.length));
  return JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(o));
}
var O_ = new Set([
  "AUTH_REQUIRED",
  "TOKEN_TOO_OLD",
  "OWNER_FORBIDDEN",
  "APP_SESSION_REVOKED",
  "APP_SESSION_ENROLL_REQUIRED",
  "ORIGIN_FORBIDDEN",
  "REGISTRY_UNAVAILABLE",
  "REGISTRY_RESULT_UNCERTAIN",
  "UNCONFIGURED",
  "CONTROL_SERVICE_UNCONFIGURED",
  "CONTROL_SERVICE_UNAVAILABLE",
  "CONTROL_RESULT_UNCERTAIN",
  "CSRF_FORBIDDEN",
]);
function Gm(e, t, n = E_, i = Date.now, a = 12e3, l = 12e3) {
  if (!e || !t) return Zc;
  try {
    if (
      ds(e.applicationOrigin) !== "https://btcpredictionlol.lovable.app" ||
      e.applicationOrigin !== t.origin ||
      t.isTopLevel !== !0 ||
      e.callbackMode !== "reviewed-pkce-code-flow-v2" ||
      !sm(e.publishableKey) ||
      typeof t.locks?.request != "function" ||
      typeof t.randomUUID != "function" ||
      typeof t.fetch != "function" ||
      typeof t.localStorage?.getItem != "function" ||
      typeof t.localStorage?.setItem != "function" ||
      typeof t.localStorage?.removeItem != "function" ||
      !Number.isFinite(a) ||
      a <= 0 ||
      !Number.isFinite(l) ||
      l <= 0
    )
      return Zc;
  } catch {
    return Zc;
  }
  let r = t.localStorage,
    s = t.locks,
    u = t.fetch,
    o = t.randomUUID,
    f = {
      getItem(c) {
        try {
          return r.getItem(c);
        } catch {
          throw new Error("Durable storage unavailable");
        }
      },
      setItem(c, h) {
        try {
          r.setItem(c, h);
        } catch {
          throw new Error("Durable storage unavailable");
        }
      },
      removeItem(c) {
        try {
          r.removeItem(c);
        } catch {
          throw new Error("Durable storage unavailable");
        }
      },
    },
    m = e.applicationOrigin,
    d = e.publishableKey,
    g = e.ownerApiPolicyRevision === Cc,
    _ = !1,
    b = null,
    A = new Set(),
    y = new Set();
  return Object.freeze({
    get available() {
      return !_;
    },
    get ownerApiAvailable() {
      return !_ && g;
    },
    close() {
      if (!_) {
        ((_ = !0), (b = null));
        for (let c of A) c.abort();
        for (let c of y) c();
        A.clear();
      }
    },
    async transact(c) {
      if (_) throw new Error("Owner sign-in closed");
      let h = new AbortController();
      A.add(h);
      let v = setTimeout(() => h.abort(), a);
      try {
        return await s.request(S_, { mode: "exclusive", signal: h.signal }, async () => {
          if ((clearTimeout(v), A.delete(h), _ || h.signal.aborted)) throw new Error("Owner sign-in closed");
          let E = JSON.stringify(R_(f.getItem(ks), o()));
          if ((f.setItem(ks, E), f.getItem(ks) !== E)) throw new Error("Durable storage unavailable");
          let O = !0,
            w = !0,
            x,
            C,
            q,
            xe = !1,
            Wt = new Set(),
            $c = () => O && !_ && w && f.getItem(ks) === E,
            he = () => {
              if (!$c()) throw new Error("Auth operation closed");
            },
            Cs = () => {
              try {
                typeof x?.auth.dispose == "function" && x.auth.dispose().catch(() => {});
              } catch {}
            },
            Us = () => {
              if (O) {
                O = !1;
                for (let T of Wt) T.abort();
                (Wt.clear(), Cs(), C?.then(Cs, Cs));
              }
            },
            Wc,
            Xm = new Promise((T, k) => {
              Wc = k;
            }),
            Fc = () => {
              (Us(), Wc(new Error("Owner sign-in closed")));
            };
          y.add(Fc);
          let Ns = (T) => T === hi || T === hi + "-code-verifier" || T === hi + "-user",
            Qm = {
              getItem(T) {
                try {
                  return $c() && Ns(T) ? f.getItem(T) : null;
                } catch {
                  return ((w = !1), null);
                }
              },
              setItem(T, k) {
                if ((he(), !Ns(T))) throw new Error("Storage key not allowed");
                if ((f.setItem(T, k), f.getItem(T) !== k)) throw new Error("Durable storage unavailable");
              },
              removeItem(T) {
                if ((he(), !Ns(T))) throw new Error("Storage key not allowed");
                if (!(T === hi + "-code-verifier" && !xe) && (f.removeItem(T), f.getItem(T) !== null))
                  throw new Error("Durable storage unavailable");
              },
            },
            Jm = async (T, k) => {
              he();
              let ne = new AbortController(),
                ft = k?.signal ?? (T instanceof Request ? T.signal : void 0),
                gi = () => ne.abort();
              if (ft?.aborted) throw new Error("Auth operation cancelled");
              (ft?.addEventListener("abort", gi, { once: !0 }), Wt.add(ne));
              try {
                let zs = await u(T, { ...k, signal: ne.signal });
                if ((he(), ne.signal.aborted)) throw new Error("Auth operation cancelled");
                return zs;
              } catch {
                throw new Error("Auth transport not confirmed");
              } finally {
                (Wt.delete(ne), ft?.removeEventListener("abort", gi));
              }
            },
            ga = async (T) => {
              if ((he(), T !== void 0 && !Cn(T))) throw new Error("Invalid flow");
              if (x && T !== void 0 && q !== T) throw new Error("Flow changed");
              if (!x) {
                q = T;
                let ne = T ? m + ii + "?flow=" + T : null;
                ((x = n(ca, d, {
                  global: { fetch: A_(Jm, ne) },
                  auth: {
                    flowType: "pkce",
                    detectSessionInUrl: !1,
                    persistSession: !0,
                    autoRefreshToken: !1,
                    skipAutoInitialize: !0,
                    storageKey: hi,
                    storage: Qm,
                  },
                })),
                  typeof x.auth.initialize == "function" && ((C = x.auth.initialize()), C.catch(() => {})));
              }
              let k = await C;
              if ((he(), k && typeof k == "object" && "error" in k && k.error))
                throw new Error("SDK initialization not confirmed");
              return (typeof x.auth.stopAutoRefresh == "function" && (await x.auth.stopAutoRefresh()), he(), x);
            },
            Ds = !1,
            ya = async (T) => {
              if ((he(), Ds)) throw new Error("Overlapping SDK operation");
              Ds = !0;
              try {
                let k = await T();
                return (he(), k);
              } catch (k) {
                throw k instanceof P ? k : new Error("Provider operation not confirmed");
              } finally {
                Ds = !1;
              }
            },
            Pc = async (T) => {
              let k = Fy(T);
              if (!g) throw new P("UNCONFIGURED", "not_sent");
              let ne = !1,
                ft,
                gi = new Promise((js, ma) => {
                  ft = setTimeout(() => {
                    ((b = null), Us(), ma(new P("TIMEOUT", ne && k.mutation ? "uncertain" : "not_sent")));
                  }, l);
                }),
                zs = ya(async () => {
                  (he(),
                    (k.kind === "enroll-current-session" || k.kind === "revoke-current-session") && (b = null),
                    (xe = !1));
                  let js = await ga(),
                    ma = await js.auth.getSession();
                  if ((he(), ma.error || !ma.data.session)) throw ((b = null), new P("AUTH_REQUIRED", "not_sent"));
                  let va = ma.data.session.access_token,
                    ke;
                  try {
                    ke = Bm(va, Math.floor(i() / 1e3));
                  } catch (dt) {
                    throw ((b = null), dt);
                  }
                  if (k.requiresFreshJwt && (ke.nowSeconds >= ke.tokenIat + 270 || ke.tokenExp - ke.nowSeconds <= 30)) {
                    let dt = await js.auth.refreshSession();
                    if ((he(), dt.error || !dt.data.session)) throw ((b = null), new P("AUTH_REQUIRED", "not_sent"));
                    va = dt.data.session.access_token;
                    let Ot = Bm(va, Math.floor(i() / 1e3));
                    if (
                      Ot.subject !== ke.subject ||
                      Ot.sessionId !== ke.sessionId ||
                      Ot.nowSeconds >= Ot.tokenIat + 270 ||
                      Ot.tokenExp - Ot.nowSeconds <= 30
                    )
                      throw ((b = null), new P("TOKEN_TOO_OLD", "not_sent"));
                    ke = Ot;
                  }
                  if (
                    (b && (b.subject !== ke.subject || b.sessionId !== ke.sessionId) && (b = null),
                    k.kind === "control-session" && b && b.expiresAt - ke.nowSeconds >= 15)
                  )
                    return Object.freeze({ csrf_token: b.csrfToken, expires_at: b.expiresAt });
                  if (
                    k.kind === "control-command" &&
                    (T.kind !== "control-command" ||
                      !b ||
                      T.csrfToken !== b.csrfToken ||
                      b.expiresAt - ke.nowSeconds < 5)
                  )
                    throw new P("CSRF_REFRESH_REQUIRED", "not_sent");
                  let pa = new AbortController();
                  Wt.add(pa);
                  try {
                    he();
                    let dt = m + k.path,
                      Ot = new Headers({ Accept: "application/json", ...k.headers, Authorization: "Bearer " + va });
                    ne = !0;
                    let Re = await u(dt, {
                      method: k.method,
                      headers: Ot,
                      ...(k.body !== void 0 ? { body: k.body } : {}),
                      signal: pa.signal,
                      credentials: "omit",
                      cache: "no-store",
                      redirect: "error",
                      referrerPolicy: "no-referrer",
                    });
                    if ((he(), pa.signal.aborted || Re.redirected || (Re.url !== "" && Re.url !== dt)))
                      throw new Error("Response destination");
                    let _a = await T_(Re, pa.signal);
                    if ((he(), !Re.ok)) {
                      let ba = _a && typeof _a == "object" && "error" in _a ? _a.error?.code : void 0;
                      (Re.status === 401 || Re.status === 403) && (b = null);
                      let Zm =
                          Re.status === 401
                            ? "AUTH_REQUIRED"
                            : Re.status === 403
                              ? "OWNER_FORBIDDEN"
                              : Re.status === 409
                                ? "STALE"
                                : Re.status === 422
                                  ? "BLOCKED"
                                  : "CONTROL_SERVICE_UNAVAILABLE",
                        $m = typeof ba == "string" && O_.has(ba) ? ba : Zm;
                      throw new P($m, k.mutation && Re.status >= 500 ? "uncertain" : "rejected", Re.status);
                    }
                    if (Re.status !== 200 && !(k.kind === "control-command" && Re.status === 202))
                      throw new P("INVALID_RESPONSE", k.mutation ? "uncertain" : "rejected", Re.status);
                    let yi = Py(k.kind, _a, { ...ke, nowSeconds: Math.floor(i() / 1e3) });
                    if ((k.kind === "control-command" || k.kind === "control-receipt") && "command_id" in yi) {
                      let ba =
                        T.kind === "control-command"
                          ? T.command.command_id
                          : T.kind === "control-receipt"
                            ? T.commandId
                            : "";
                      if (yi.command_id !== ba) throw new P("INVALID_RESPONSE", "uncertain");
                    }
                    return (
                      k.kind === "control-session" &&
                        "csrf_token" in yi &&
                        (b = {
                          subject: ke.subject,
                          sessionId: ke.sessionId,
                          csrfToken: yi.csrf_token,
                          expiresAt: yi.expires_at,
                        }),
                      yi
                    );
                  } catch (dt) {
                    throw dt instanceof P
                      ? dt
                      : new P("CONTROL_SERVICE_UNAVAILABLE", ne && k.mutation ? "uncertain" : "not_sent");
                  } finally {
                    ((va = ""), Wt.delete(pa));
                  }
                });
              try {
                return await Promise.race([zs, gi]);
              } finally {
                clearTimeout(ft);
              }
            },
            ef = Object.freeze({
              ownerRequest: Pc,
              signOutWithRevocation: async () => {
                let T = "not_configured";
                if (g)
                  try {
                    (await Pc({ kind: "revoke-current-session" }), (T = "confirmed"));
                  } catch (k) {
                    T = k instanceof P && k.outcome === "rejected" ? "rejected" : "uncertain";
                  }
                if (!O || _) return { appRevocation: T, providerSignOut: "not_attempted" };
                try {
                  return (await ef.signOut(), { appRevocation: T, providerSignOut: "confirmed" });
                } catch {
                  return { appRevocation: T, providerSignOut: "uncertain" };
                }
              },
              store: Object.freeze({
                getItem(T) {
                  if ((he(), T !== xn && T !== kn)) throw new Error("Journal key not allowed");
                  return f.getItem(T);
                },
                setItem(T, k) {
                  if ((he(), T !== xn && T !== kn)) throw new Error("Journal key not allowed");
                  f.setItem(T, k);
                },
              }),
              newFlowId() {
                he();
                let T = o();
                if (!Cn(T)) throw new Error("Secure randomness unavailable");
                return T;
              },
              sendLink: (T, k) =>
                ya(async () => {
                  let ne = await ga(k);
                  xe = !0;
                  let { error: ft } = await ne.auth.signInWithOtp({
                    email: T,
                    options: { shouldCreateUser: !1, emailRedirectTo: m + ii + "?flow=" + k },
                  });
                  if (ft) throw new Error("Sign-in request not confirmed");
                }),
              exchangeCode: (T, k) =>
                ya(async () => {
                  let ne = await ga(k);
                  xe = !0;
                  let { data: ft, error: gi } = await ne.auth.exchangeCodeForSession(T);
                  if (gi || !ft.session || !ft.user) throw new Error("Sign-in link not verified");
                }),
              currentIdentity: () =>
                ya(async () => {
                  xe = !1;
                  let { data: T, error: k } = await (await ga()).auth.getUser();
                  if (si(k)) return { kind: "signed_out" };
                  if (k) throw new Error("Current sign-in not confirmed");
                  let ne = T.user;
                  return !ne || ne.is_anonymous !== !1
                    ? { kind: "signed_out" }
                    : {
                        kind: "signed_in",
                        emailVerified: nm(ne.email_confirmed_at, i()),
                        ...(typeof ne.email == "string" && cs(ne.email) ? { email: ne.email } : {}),
                      };
                }),
              signOut: () =>
                ya(async () => {
                  b = null;
                  let T = await ga();
                  xe = !0;
                  let { error: k } = await T.auth.signOut({ scope: "local" });
                  if (k) throw new Error("Sign-out not confirmed");
                }),
            });
          try {
            return await Promise.race([Promise.resolve().then(() => (he(), c(ef))), Xm]);
          } finally {
            (Us(), y.delete(Fc));
          }
        });
      } catch (E) {
        throw E instanceof P ? E : new Error("Owner sign-in operation not confirmed");
      } finally {
        (clearTimeout(v), A.delete(h));
      }
    },
  });
}
function Km() {
  if (!(typeof window > "u"))
    try {
      return {
        origin: window.location.origin,
        isTopLevel: window.top === window.self,
        localStorage: window.localStorage,
        locks: window.navigator.locks,
        randomUUID: () => window.crypto.randomUUID(),
        fetch: window.fetch.bind(window),
      };
    } catch {
      return;
    }
}
function Ym(e, t, n, i) {
  let a = e.mode === "callback" ? ii : "/owner/login",
    l = "https://btcpredictionlol.lovable.app",
    r = null,
    s = null,
    u = null,
    o = null,
    f = !1,
    m = e.callbackUrl;
  e.callbackUrl = null;
  let d = () =>
      t.location.origin === l && t.location.pathname === a && t.location.search === "" && t.location.hash === "",
    g = () => {
      if (!f) {
        if (((f = !0), (m = null), r)) r.close();
        else
          try {
            s?.close?.();
          } catch {}
        (u?.(), o?.(), n.unmount(), n.unavailable());
      }
    };
  try {
    if (!d() || !["login", "callback"].includes(e.mode) || (e.mode === "callback" && typeof m != "string"))
      throw new Error("Unavailable");
    let _ = t.onLeave(g);
    if (f) return (_(), g);
    if (((u = _), (s = i(e.config)), f)) {
      try {
        s.close?.();
      } catch {}
      return g;
    }
    if (!d()) return (g(), g);
    if (((r = new fs(s, l)), f)) return (r.close(), g);
    let b = r;
    if (((o = t.onSessionChange?.(() => b.notifySessionChanged()) ?? null), f)) return (o?.(), g);
    if ((n.mount(r), f)) return g;
    if ((e.mode === "login" && r.initialize().then(() => b.checkCurrentSignIn()), e.mode === "callback" && m)) {
      let A = m;
      ((m = null),
        r.completeCallback(A, {
          scrub: () => {
            if ((t.replaceState(ii), !d())) throw new Error("Scrub failed");
          },
        }));
    }
  } catch {
    g();
  }
  return g;
}
var Vm = mi(Sl(), 1);
function _w(e) {
  let t = document.getElementById("owner-auth-root");
  if (!t) return () => {};
  let n = null;
  return Ym(
    e,
    {
      location: window.location,
      replaceState: (i) => window.history.replaceState(null, "", i),
      onSessionChange: (i) => {
        let a = (r) => {
            r.storageArea === window.localStorage &&
              (r.key === hi || r.key === xn || r.key === kn || r.key === null) &&
              i();
          },
          l = () => {
            document.visibilityState === "visible" && i();
          };
        return (
          window.addEventListener("storage", a),
          window.addEventListener("focus", l),
          document.addEventListener("visibilitychange", l),
          () => {
            (window.removeEventListener("storage", a),
              window.removeEventListener("focus", l),
              document.removeEventListener("visibilitychange", l));
          }
        );
      },
      onLeave: (i) => {
        for (let a of ["pagehide", "popstate", "hashchange"]) window.addEventListener(a, i);
        return () => {
          for (let a of ["pagehide", "popstate", "hashchange"]) window.removeEventListener(a, i);
        };
      },
    },
    {
      mount: (i) => {
        ((n = (0, Im.createRoot)(t)), n.render((0, Vm.jsx)(rm, { controller: i })));
      },
      unmount: () => {
        (n?.unmount(), (n = null));
      },
      unavailable: () => {
        t.textContent = "Sign-in is unavailable. Reload this page to try again.";
      },
    },
    (i) => Gm(i ?? void 0, Km()),
  );
}
export { _w as startStandaloneOwnerPage };
/*! Bundled license information:

scheduler/cjs/scheduler.production.js:
  (**
   * @license React
   * scheduler.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.js:
  (**
   * @license React
   * react-dom.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom-client.production.js:
  (**
   * @license React
   * react-dom-client.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.js:
  (**
   * @license React
   * react-jsx-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
