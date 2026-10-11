"use strict";
// === @workspace/backend-common ===
// Shared backend utilities consumed by domain packages.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCache = exports.setCachedData = exports.getCachedData = exports.delCache = exports.setCache = exports.getCache = exports.pdfUtils = exports.queueService = exports.EmailService = exports.registerSocketProvider = exports.emitSocket = exports.registerAutomationProvider = exports.triggerAutomation = exports.logAction = exports.eventBus = void 0;
var eventBus_1 = require("./eventBus");
Object.defineProperty(exports, "eventBus", { enumerable: true, get: function () { return eventBus_1.eventBus; } });
var audit_1 = require("./audit");
Object.defineProperty(exports, "logAction", { enumerable: true, get: function () { return audit_1.logAction; } });
var automation_1 = require("./automation");
Object.defineProperty(exports, "triggerAutomation", { enumerable: true, get: function () { return automation_1.triggerAutomation; } });
Object.defineProperty(exports, "registerAutomationProvider", { enumerable: true, get: function () { return automation_1.registerAutomationProvider; } });
var socket_1 = require("./socket");
Object.defineProperty(exports, "emitSocket", { enumerable: true, get: function () { return socket_1.emitSocket; } });
Object.defineProperty(exports, "registerSocketProvider", { enumerable: true, get: function () { return socket_1.registerSocketProvider; } });
var email_service_1 = require("./email.service");
Object.defineProperty(exports, "EmailService", { enumerable: true, get: function () { return email_service_1.EmailService; } });
exports.queueService = __importStar(require("./queue.service"));
exports.pdfUtils = __importStar(require("./pdf.utils"));
var cache_1 = require("./cache");
Object.defineProperty(exports, "getCache", { enumerable: true, get: function () { return cache_1.getCache; } });
Object.defineProperty(exports, "setCache", { enumerable: true, get: function () { return cache_1.setCache; } });
Object.defineProperty(exports, "delCache", { enumerable: true, get: function () { return cache_1.delCache; } });
Object.defineProperty(exports, "getCachedData", { enumerable: true, get: function () { return cache_1.getCachedData; } });
Object.defineProperty(exports, "setCachedData", { enumerable: true, get: function () { return cache_1.setCachedData; } });
Object.defineProperty(exports, "clearCache", { enumerable: true, get: function () { return cache_1.clearCache; } });
