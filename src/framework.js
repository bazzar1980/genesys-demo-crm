var contactSearchCallback;

// Resolve agent names when participant.name is undefined.
// GCV does not pass UUI on consult/warm transfers, so participants may
// arrive with name: undefined and only userId/address.
var _gcAuthToken = null;
var _gcApiEnv = null;
var _gcCurrentUserId = null;
var _userNameCache = {}; // userId -> name
var _userNamePending = {}; // userId -> [callbacks]
var _appliedNamesByInteraction = {}; // interactionId -> signature

function getApiEnv() {
    if (_gcApiEnv) return _gcApiEnv;
    _gcApiEnv = Object.keys(window.Framework.config.clientIds).find(function(k) {
        return window.Framework.config.clientIds[k] && window.Framework.config.clientIds[k].length > 0;
    }) || 'mypurecloud.ie';
    return _gcApiEnv;
}

function resolveUserName(userId, callback) {
    if (!userId) return callback(null);
    if (_userNameCache[userId]) return callback(_userNameCache[userId]);
    if (!_gcAuthToken) return callback(null);

    if (_userNamePending[userId]) {
        _userNamePending[userId].push(callback);
        return;
    }

    _userNamePending[userId] = [callback];

    fetch('https://api.' + getApiEnv() + '/api/v2/users/' + encodeURIComponent(userId) + '?fields=name', {
        headers: {
            'Authorization': 'Bearer ' + _gcAuthToken
        }
    })
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(u) {
        var name = u && u.name ? u.name : null;
        if (name) _userNameCache[userId] = name;

        var cbs = _userNamePending[userId] || [];
        delete _userNamePending[userId];

        cbs.forEach(function(cb) {
            cb(name);
        });
    })
    .catch(function() {
        var cbs = _userNamePending[userId] || [];
        delete _userNamePending[userId];

        cbs.forEach(function(cb) {
            cb(null);
        });
    });
}

function enrichParticipantNames(interaction, done) {
    var participants = interaction && interaction.participants;
    if (!Array.isArray(participants) || participants.length === 0) return done(interaction);

    var todo = participants.filter(function(p) {
        return p && !p.name && p.userId;
    });

    if (todo.length === 0) return done(interaction);

    var remaining = todo.length;

    todo.forEach(function(p) {
        resolveUserName(p.userId, function(name) {
            if (name) p.name = name;
            if (--remaining === 0) done(interaction);
        });
    });
}

function publishParticipantNames(interaction) {
    if (!interaction || !interaction.id || !Array.isArray(interaction.participants)) return;

    var participants = interaction.participants.filter(function(p) {
        return p && p.userId && p.name;
    });

    if (participants.length === 0) return;

    var names = participants.map(function(p) {
        return p.name;
    });

    // Select another Genesys user as the transferring agent.
    // In the warm transfer scenario this is normally the agent
    // different from the currently logged-in receiving agent.
    var transferFromParticipant = participants.find(function(p) {
        return !_gcCurrentUserId || p.userId !== _gcCurrentUserId;
    });

    var transferFromName = transferFromParticipant
        ? transferFromParticipant.name
        : null;

    var signature = names.join('|') + '::' + (transferFromName || '');

    if (_appliedNamesByInteraction[interaction.id] === signature) return;
    _appliedNamesByInteraction[interaction.id] = signature;

    var attributes = {
        PT_ParticipantNames: names.join('|')
    };

    if (transferFromName) {
        attributes['participant.TransferFromName'] = transferFromName;
    }

    try {
        window.PureCloud.addCustomAttributes({
            interactionId: interaction.id,
            attributes: attributes
        });
    } catch (e) {
        console.warn('[GCEF] addCustomAttributes failed:', e);
    }
}

window.Framework = {
    config: {
        name: "Genesys CRM Demo",
        clientIds: {
            'mypurecloud.com': '',
            'mypurecloud.ie': '',
            'mypurecloud.com.au': '',
            'mypurecloud.jp': '',
            'mypurecloud.de': ''
        },
        getUserLanguage: function(callback) {
            callback("en-EN");
        },
        customInteractionAttributes: [
            'normalizedNumber',
            'PT_URLPop',
            'PT_SearchValue',
            'PT_TransferContext',
            'OrderNumber',
            'PT_ParticipantNames',
            'TransferFromName'
        ],
        settings: {
            embedWebRTCByDefault: true,
            dedicatedLoginWindow: true,
            hideWebRTCPopUpOption: false,
            enableCallLogs: true,
            enableTransferContext: true,
            enableCallHistory: true,
            hideCallLogSubject: true,
            hideCallLogContact: false,
            hideCallLogRelation: false,
            disableInteractionDeallocationDelay: true,
            searchTargets: [
                'people',
                'queues',
                'frameworkcontacts',
                'externalContacts'
            ],
            display: {
                interactionDetails: {
                    call: [
                        'participant.TransferFromName'
                    ]
                }
            },
            theme: {
                primary: '#cdd4bd',
                text: '#123'
            }
        }
    },

    initialSetup: function() {
        function captureSession() {
            window.PureCloud.User.getAuthToken(function(token) {
                if (!token) return;

                _gcAuthToken = token;

                var env = getApiEnv();

                fetch('https://api.' + env + '/api/v2/users/me?fields=id', {
                    headers: {
                        'Authorization': 'Bearer ' + token
                    }
                })
                .then(function(r) {
                    return r.json();
                })
                .then(function(me) {
                    if (me && me.id) {
                        _gcCurrentUserId = me.id;

                        window.parent.postMessage(
                            JSON.stringify({
                                type: 'agentSession',
                                data: {
                                    userId: me.id,
                                    token: token,
                                    environment: env
                                }
                            }),
                            '*'
                        );
                    }
                })
                .catch(function() {
                    window.parent.postMessage(
                        JSON.stringify({
                            type: 'agentSession',
                            data: {
                                userId: null,
                                token: token,
                                environment: env
                            }
                        }),
                        '*'
                    );
                });
            });
        }

        window.PureCloud.subscribe([
            {
                type: 'Interaction',
                callback: function(category, interaction) {
                    const schema = {};

                    Object.keys(interaction).forEach(function(key) {
                        const value = interaction[key];

                        schema[key] =
                            value === null
                                ? "null"
                                : Array.isArray(value)
                                    ? "array"
                                    : typeof value;
                    });

                    console.log("GCEF CATEGORY:", category);
                    console.log("GCEF SCHEMA:", JSON.stringify(schema, null, 2));
                    console.log("GCEF PAYLOAD:", JSON.stringify(interaction, null, 2));

                    // Resolve missing participant names via Users API.
                    enrichParticipantNames(interaction, function(enriched) {
                        publishParticipantNames(enriched);

                        window.parent.postMessage(
                            JSON.stringify({
                                type: "interactionSubscription",
                                data: {
                                    category: category,
                                    interaction: enriched
                                }
                            }),
                            "*"
                        );
                    });
                }
            },
            {
                type: 'UserAction',
                callback: function(category, data) {
                    window.parent.postMessage(
                        JSON.stringify({
                            type: "userActionSubscription",
                            data: {
                                category: category,
                                data: data
                            }
                        }),
                        "*"
                    );

                    if (category === 'login') {
                        captureSession();
                    }

                    if (category === 'logout') {
                        _gcAuthToken = null;
                        _gcCurrentUserId = null;

                        window.parent.postMessage(
                            JSON.stringify({
                                type: 'agentLogout'
                            }),
                            '*'
                        );
                    }
                }
            },
            {
                type: 'Notification',
                callback: function(category, data) {
                    window.parent.postMessage(
                        JSON.stringify({
                            type: "notificationSubscription",
                            data: {
                                category: category,
                                data: data
                            }
                        }),
                        "*"
                    );
                }
            }
        ]);

        var _pendingSessions = {};

        function hookWebRTC() {
            var sdk = window.PureCloud && (
                window.PureCloud.SDK ||
                window.PureCloud._webrtcSdk ||
                window.PureCloud.webrtcSdk
            );

            if (sdk && sdk.on) {
                sdk.on('pendingSession', function(session) {
                    _pendingSessions[session.conversationId] = session;
                    _pendingSessions[session.sessionId] = session;
                });

                sdk.on('sessionStarted', function(session) {
                    delete _pendingSessions[session.conversationId];
                    delete _pendingSessions[session.sessionId];
                });

                sdk.on('sessionEnded', function(session) {
                    delete _pendingSessions[session.conversationId];
                    delete _pendingSessions[session.sessionId];
                });
            }
        }

        hookWebRTC();
        setTimeout(hookWebRTC, 2000);
        setTimeout(hookWebRTC, 5000);

        window.addEventListener("message", function(event) {
            try {
                var message = JSON.parse(event.data);

                if (message) {
                    if (message.type == "clickToDial") {
                        window.PureCloud.clickToDial(message.data);

                    } else if (message.type == "addAssociation") {
                        window.PureCloud.addAssociation(message.data);

                    } else if (message.type == "addAttribute") {
                        window.PureCloud.addCustomAttributes(message.data);

                    } else if (message.type == "addTransferContext") {
                        window.PureCloud.addTransferContext(message.data);

                    } else if (message.type == "sendContactSearch") {
                        if (contactSearchCallback) {
                            contactSearchCallback(message.data);
                        }

                    } else if (message.type == "updateUserStatus") {
                        window.PureCloud.User.updateStatus(message.data);

                    } else if (message.type == "updateInteractionState") {
                        var action = message.data && message.data.action;
                        var interactionId = message.data && message.data.id;

                        if (action === 'pickup' && interactionId) {
                            var pending = _pendingSessions[interactionId];

                            if (pending) {
                                try {
                                    if (window.PureCloud.acceptPendingSession) {
                                        window.PureCloud.acceptPendingSession(
                                            pending.sessionId || pending.id
                                        );
                                    } else {
                                        var sdk = window.PureCloud && (
                                            window.PureCloud.SDK ||
                                            window.PureCloud._webrtcSdk ||
                                            window.PureCloud.webrtcSdk
                                        );

                                        if (sdk && sdk.acceptPendingSession) {
                                            sdk.acceptPendingSession({
                                                sessionId: pending.sessionId || pending.id
                                            });
                                        }
                                    }
                                } catch (e) {}
                            }
                        }

                        window.PureCloud.Interaction.updateState(message.data);

                    } else if (message.type == "focusInteraction") {
                        var interactionId = message.data && message.data.id;

                        console.log(
                            "[GCEF] focusInteraction request:",
                            interactionId
                        );

                        if (!interactionId) return;

                        try {
                            var clientApps = window.purecloud && window.purecloud.apps;

                            if (
                                clientApps &&
                                clientApps.myConversations &&
                                clientApps.myConversations.setActiveConversation
                            ) {
                                console.log(
                                    "[GCEF] trying setActiveConversation"
                                );

                                clientApps.myConversations.setActiveConversation(
                                    interactionId
                                );
                            } else {
                                console.warn(
                                    "[GCEF] setActiveConversation not available"
                                );
                            }
                        } catch (e) {
                            console.warn(
                                "[GCEF] setActiveConversation failed:",
                                e
                            );
                        }

                        try {
                            window.PureCloud.Interaction.updateState({
                                id: interactionId,
                                action: "pickup"
                            });
                        } catch (e) {
                            console.error(
                                "[GCEF] pickup failed:",
                                e
                            );
                        }

                    } else if (message.type == "setView") {
                        window.PureCloud.User.setView(message.data);

                    } else if (message.type == "updateAudioConfiguration") {
                        window.PureCloud.User.Notification.setAudioConfiguration(
                            message.data
                        );

                    } else if (message.type == "sendCustomNotification") {
                        window.PureCloud.User.Notification.notifyUser(
                            message.data
                        );
                    }
                }
            } catch (e) {
                // Ignore messages that cannot be parsed as JSON.
            }
        });
    },

    screenPop: function(searchString, interaction) {
        window.parent.postMessage(
            JSON.stringify({
                type: "screenPop",
                data: {
                    searchString: searchString,
                    interactionId: interaction
                }
            }),
            "*"
        );
    },

    processCallLog: function(
        callLog,
        interaction,
        eventName,
        onSuccess,
        onFailure
    ) {
        window.parent.postMessage(
            JSON.stringify({
                type: "processCallLog",
                data: {
                    callLog: callLog,
                    interactionId: (
                        interaction && interaction.id
                            ? interaction.id
                            : interaction
                    ),
                    interaction: interaction,
                    eventName: eventName
                }
            }),
            "*"
        );

        var success = true;

        if (success) {
            onSuccess({
                id: callLog.id || Date.now()
            });
        } else {
            onFailure();
        }
    },

    openCallLog: function(callLog, interaction) {
        window.parent.postMessage(
            JSON.stringify({
                type: "openCallLog",
                data: {
                    callLog: callLog,
                    interaction: interaction
                }
            }),
            "*"
        );
    },

    contactSearch: function(searchString, onSuccess, onFailure) {
        contactSearchCallback = onSuccess;

        window.parent.postMessage(
            JSON.stringify({
                type: "contactSearch",
                data: {
                    searchString: searchString
                }
            }),
            "*"
        );
    }
};