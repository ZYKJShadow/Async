/**
 * Hook script injected into every browser tab when capture is active.
 *
 * Intercepts fetch / XMLHttpRequest / crypto.subtle and a handful of common
 * third-party crypto libraries. Events are queued on `window.__asyncHookQueue`
 * and drained periodically by the renderer via `executeJavaScript`.
 *
 * The script is intentionally written as a single self-invoking IIFE so it can
 * be re-injected after every navigation without leaking state.
 */

const BROWSER_HOOK_SCRIPT_SOURCE = String.raw`
(function(){
	if (window.__asyncHookInstalled) {
		return;
	}
	Object.defineProperty(window, '__asyncHookInstalled', { value: true, writable: false, configurable: false });

	var QUEUE_CAP = 600;
	var queue = [];
	window.__asyncHookQueue = queue;
	window.__asyncDrainHooks = function() {
		var snapshot = queue.splice(0, queue.length);
		return snapshot;
	};

	function nowMs() { return Date.now(); }

	function safeStringify(value, max) {
		try {
			if (value === undefined) return '';
			if (typeof value === 'string') return value.length > max ? value.slice(0, max) + '…' : value;
			if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
			if (value instanceof ArrayBuffer) return arrayBufferToHex(value, max / 2);
			if (ArrayBuffer.isView(value)) return arrayBufferToHex(value.buffer, max / 2);
			if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) return arrayBufferToHex(value.buffer, max / 2);
			if (value instanceof Blob) return '[Blob ' + value.size + 'b ' + (value.type || 'unknown') + ']';
			if (value instanceof FormData) {
				var entries = [];
				value.forEach(function(v, k) { entries.push(k + '=' + (typeof v === 'string' ? v.slice(0, 80) : '[Blob]')); });
				return entries.join('&').slice(0, max);
			}
			if (value instanceof URLSearchParams) return value.toString().slice(0, max);
			var seen = new WeakSet();
			var out = JSON.stringify(value, function(k, v) {
				if (typeof v === 'object' && v !== null) {
					if (seen.has(v)) return '[circular]';
					seen.add(v);
				}
				if (typeof v === 'string' && v.length > 800) return v.slice(0, 800) + '…';
				return v;
			});
			return out && out.length > max ? out.slice(0, max) + '…' : (out || '');
		} catch (_) {
			try { return String(value).slice(0, max); } catch (__) { return ''; }
		}
	}

	function arrayBufferToHex(buffer, maxBytes) {
		try {
			var view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, maxBytes || 256));
			var hex = '';
			for (var i = 0; i < view.length; i++) {
				var b = view[i].toString(16);
				hex += b.length === 1 ? ('0' + b) : b;
			}
			if (buffer.byteLength > view.length) hex += '…';
			return hex;
		} catch (_) { return ''; }
	}

	function callStack() {
		try {
			var lines = (new Error()).stack || '';
			lines = lines.split('\n');
			var trimmed = [];
			for (var i = 0; i < lines.length; i++) {
				var line = lines[i].trim();
				if (!line) continue;
				if (line.indexOf('__asyncHook') >= 0) continue;
				if (line.indexOf('asyncDrainHooks') >= 0) continue;
				trimmed.push(line);
				if (trimmed.length >= 6) break;
			}
			return trimmed.join('\n');
		} catch (_) { return ''; }
	}

	function pushEvent(category, label, args, result) {
		try {
			if (queue.length >= QUEUE_CAP) {
				queue.splice(0, queue.length - QUEUE_CAP + 1);
			}
			queue.push({
				ts: nowMs(),
				url: location && location.href ? location.href : '',
				category: category,
				label: label,
				args: args || null,
				result: result || null,
				stack: callStack(),
			});
		} catch (_) { /* ignore */ }
	}

	// --- fetch ---
	try {
		var originalFetch = window.fetch;
		if (typeof originalFetch === 'function') {
			window.fetch = function(input, init) {
				var url = '';
				var method = 'GET';
				try {
					if (typeof input === 'string') { url = input; }
					else if (input instanceof URL) { url = input.href; }
					else if (input && typeof input === 'object') { url = input.url || ''; method = input.method || method; }
					if (init && init.method) method = init.method;
				} catch (_) {}
				var requestId = '__h' + Math.random().toString(36).slice(2, 8);
				pushEvent('fetch', 'fetch', { id: requestId, method: method, url: url, body: init && init.body ? safeStringify(init.body, 800) : '' }, null);
				try {
					var promise = originalFetch.apply(this, arguments);
					promise.then(function(res) {
						pushEvent('fetch', 'fetch.response', { id: requestId, method: method, url: url }, { status: res.status });
					}).catch(function(err) {
						pushEvent('fetch', 'fetch.error', { id: requestId, method: method, url: url }, { error: safeStringify(err, 200) });
					});
					return promise;
				} catch (e) {
					pushEvent('fetch', 'fetch.error', { id: requestId, method: method, url: url }, { error: safeStringify(e, 200) });
					throw e;
				}
			};
		}
	} catch (_) {}

	// --- XHR ---
	try {
		var XHRProto = XMLHttpRequest.prototype;
		var origOpen = XHRProto.open;
		var origSend = XHRProto.send;
		var origSetHeader = XHRProto.setRequestHeader;
		XHRProto.open = function(method, url) {
			try {
				this.__asyncHookMethod = method;
				this.__asyncHookUrl = typeof url === 'string' ? url : (url && url.href) || '';
				this.__asyncHookHeaders = {};
			} catch (_) {}
			return origOpen.apply(this, arguments);
		};
		XHRProto.setRequestHeader = function(name, value) {
			try { (this.__asyncHookHeaders || (this.__asyncHookHeaders = {}))[name] = value; } catch (_) {}
			return origSetHeader.apply(this, arguments);
		};
		XHRProto.send = function(body) {
			var self = this;
			var requestId = '__h' + Math.random().toString(36).slice(2, 8);
			pushEvent('xhr', 'XMLHttpRequest.send', {
				id: requestId,
				method: self.__asyncHookMethod || 'GET',
				url: self.__asyncHookUrl || '',
				headers: self.__asyncHookHeaders || {},
				body: body == null ? '' : safeStringify(body, 800),
			}, null);
			try {
				self.addEventListener('loadend', function() {
					pushEvent('xhr', 'XMLHttpRequest.response', {
						id: requestId,
						method: self.__asyncHookMethod || 'GET',
						url: self.__asyncHookUrl || '',
					}, { status: self.status });
				});
			} catch (_) {}
			return origSend.apply(this, arguments);
		};
	} catch (_) {}

	// --- crypto.subtle ---
	try {
		if (window.crypto && window.crypto.subtle) {
			var subtle = window.crypto.subtle;
			['sign', 'verify', 'digest', 'encrypt', 'decrypt', 'deriveKey', 'deriveBits', 'importKey', 'exportKey', 'wrapKey', 'unwrapKey'].forEach(function(method) {
				if (typeof subtle[method] !== 'function') return;
				var orig = subtle[method].bind(subtle);
				subtle[method] = function() {
					var args = Array.prototype.slice.call(arguments);
					var preview = args.map(function(a) { return safeStringify(a, 200); });
					pushEvent('crypto.subtle', 'crypto.subtle.' + method, { args: preview }, null);
					try {
						var result = orig.apply(null, args);
						if (result && typeof result.then === 'function') {
							result.then(function(value) {
								pushEvent('crypto.subtle', 'crypto.subtle.' + method + '.result', { args: preview }, { value: safeStringify(value, 200) });
							}).catch(function(err) {
								pushEvent('crypto.subtle', 'crypto.subtle.' + method + '.error', { args: preview }, { error: safeStringify(err, 200) });
							});
						}
						return result;
					} catch (e) {
						pushEvent('crypto.subtle', 'crypto.subtle.' + method + '.error', { args: preview }, { error: safeStringify(e, 200) });
						throw e;
					}
				};
			});
		}
	} catch (_) {}

	// --- third-party crypto libs ---
	function wrapMethod(target, method, label) {
		try {
			if (!target || typeof target[method] !== 'function') return;
			var orig = target[method];
			target[method] = function() {
				var args = Array.prototype.slice.call(arguments);
				var preview = args.map(function(a) { return safeStringify(a, 200); });
				pushEvent('crypto.lib', label + '.' + method, { args: preview }, null);
				try {
					var result = orig.apply(this, args);
					if (result && typeof result === 'object' && typeof result.toString === 'function' && result.toString !== Object.prototype.toString) {
						pushEvent('crypto.lib', label + '.' + method + '.result', { args: preview }, { value: safeStringify(result.toString(), 200) });
					}
					return result;
				} catch (e) {
					pushEvent('crypto.lib', label + '.' + method + '.error', { args: preview }, { error: safeStringify(e, 200) });
					throw e;
				}
			};
		} catch (_) {}
	}

	function hookCryptoJS(lib) {
		if (!lib || lib.__asyncHooked) return;
		try { lib.__asyncHooked = true; } catch (_) { return; }
		['AES', 'DES', 'TripleDES', 'Rabbit', 'RC4', 'Blowfish'].forEach(function(name) {
			if (lib[name]) {
				wrapMethod(lib[name], 'encrypt', 'CryptoJS.' + name);
				wrapMethod(lib[name], 'decrypt', 'CryptoJS.' + name);
			}
		});
		['MD5', 'SHA1', 'SHA224', 'SHA256', 'SHA384', 'SHA512', 'SHA3', 'RIPEMD160'].forEach(function(name) {
			if (typeof lib[name] === 'function') {
				var orig = lib[name];
				lib[name] = function() {
					var args = Array.prototype.slice.call(arguments);
					pushEvent('crypto.lib', 'CryptoJS.' + name, { args: args.map(function(a) { return safeStringify(a, 200); }) }, null);
					var result = orig.apply(this, args);
					if (result && result.toString) {
						pushEvent('crypto.lib', 'CryptoJS.' + name + '.result', null, { value: safeStringify(result.toString(), 200) });
					}
					return result;
				};
			}
		});
		['HmacMD5', 'HmacSHA1', 'HmacSHA256', 'HmacSHA512'].forEach(function(name) {
			if (typeof lib[name] === 'function') {
				var orig = lib[name];
				lib[name] = function() {
					var args = Array.prototype.slice.call(arguments);
					pushEvent('crypto.lib', 'CryptoJS.' + name, { args: args.map(function(a) { return safeStringify(a, 200); }) }, null);
					var result = orig.apply(this, args);
					if (result && result.toString) {
						pushEvent('crypto.lib', 'CryptoJS.' + name + '.result', null, { value: safeStringify(result.toString(), 200) });
					}
					return result;
				};
			}
		});
		if (lib.PBKDF2 && typeof lib.PBKDF2 === 'function') {
			var origPbkdf2 = lib.PBKDF2;
			lib.PBKDF2 = function() {
				var args = Array.prototype.slice.call(arguments);
				pushEvent('crypto.lib', 'CryptoJS.PBKDF2', { args: args.map(function(a) { return safeStringify(a, 200); }) }, null);
				var result = origPbkdf2.apply(this, args);
				if (result && result.toString) {
					pushEvent('crypto.lib', 'CryptoJS.PBKDF2.result', null, { value: safeStringify(result.toString(), 200) });
				}
				return result;
			};
		}
		if (lib.enc) {
			['Base64', 'Hex', 'Utf8', 'Latin1'].forEach(function(name) {
				if (lib.enc[name]) {
					wrapMethod(lib.enc[name], 'stringify', 'CryptoJS.enc.' + name);
					wrapMethod(lib.enc[name], 'parse', 'CryptoJS.enc.' + name);
				}
			});
		}
	}

	function hookJSEncrypt(klass) {
		if (!klass || klass.__asyncHooked) return;
		try { klass.__asyncHooked = true; } catch (_) { return; }
		if (klass.prototype) {
			['encrypt', 'decrypt', 'sign', 'verify', 'setPublicKey', 'setPrivateKey'].forEach(function(method) {
				wrapMethod(klass.prototype, method, 'JSEncrypt');
			});
		}
	}

	function hookForge(forge) {
		if (!forge || forge.__asyncHooked) return;
		try { forge.__asyncHooked = true; } catch (_) { return; }
		if (forge.pki) {
			wrapMethod(forge.pki, 'publicKeyFromPem', 'forge.pki');
			wrapMethod(forge.pki, 'privateKeyFromPem', 'forge.pki');
			wrapMethod(forge.pki, 'certificateFromPem', 'forge.pki');
		}
		if (forge.cipher) {
			wrapMethod(forge.cipher, 'createCipher', 'forge.cipher');
			wrapMethod(forge.cipher, 'createDecipher', 'forge.cipher');
		}
		if (forge.md) {
			['md5', 'sha1', 'sha256', 'sha512'].forEach(function(alg) {
				if (forge.md[alg]) wrapMethod(forge.md[alg], 'create', 'forge.md.' + alg);
			});
		}
		if (forge.util) {
			wrapMethod(forge.util, 'encode64', 'forge.util');
			wrapMethod(forge.util, 'decode64', 'forge.util');
		}
		if (forge.hmac) wrapMethod(forge.hmac, 'create', 'forge.hmac');
	}

	function hookSm(name, obj) {
		if (!obj || obj.__asyncHooked) return;
		try { obj.__asyncHooked = true; } catch (_) { return; }
		['doEncrypt', 'doDecrypt', 'doSignature', 'doVerifySignature', 'encrypt', 'decrypt'].forEach(function(method) {
			wrapMethod(obj, method, name);
		});
	}

	function trapGlobal(name, hook) {
		try {
			if (window[name]) { hook(window[name]); return; }
			var stash;
			Object.defineProperty(window, name, {
				configurable: true,
				enumerable: true,
				get: function() { return stash; },
				set: function(value) {
					stash = value;
					if (value) {
						try { hook(value); } catch (_) {}
					}
				},
			});
		} catch (_) {}
	}

	trapGlobal('CryptoJS', hookCryptoJS);
	trapGlobal('JSEncrypt', hookJSEncrypt);
	trapGlobal('forge', hookForge);
	trapGlobal('sm2', function(obj) { hookSm('sm2', obj); });
	trapGlobal('sm3', function(obj) { hookSm('sm3', obj); });
	trapGlobal('sm4', function(obj) { hookSm('sm4', obj); });

	// --- btoa / atob ---
	try {
		var origBtoa = window.btoa;
		var origAtob = window.atob;
		window.btoa = function(s) { pushEvent('crypto.lib', 'btoa', { input: safeStringify(s, 200) }, null); return origBtoa.apply(this, arguments); };
		window.atob = function(s) { pushEvent('crypto.lib', 'atob', { input: safeStringify(s, 200) }, null); return origAtob.apply(this, arguments); };
	} catch (_) {}
})();
`;

export function getBrowserHookScript(): string {
	return BROWSER_HOOK_SCRIPT_SOURCE;
}

export function getBrowserHookDrainScript(): string {
	return `(function(){ try { return window.__asyncDrainHooks ? window.__asyncDrainHooks() : []; } catch(_) { return []; } })()`;
}
