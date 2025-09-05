var selectedChatTab      = 0; // 0 is the page chat, 1 is the global chat
var chatOpen             = 0;
var chatPageUnread       = 0;
var chatGlobalUnread     = 0;
var initPageTabOpen      = false;
var initGlobalTabOpen    = false;
var initChatOpen         = false;
var chatWriteHistory     = []; // history of user's chats
var chatRecordsPage      = [];
var chatRecordsGlobal    = [];
var chatAdditionsPage    = [];
var chatAdditionsGlobal  = [];
var chatCommandRegistry  = {};
var chatWriteHistoryMax  = 100; // maximum size of chat write history length
var chatHistoryLimit     = 3500;
var chatWriteHistoryIdx  = -1; // location in chat write history
var chatLimitCombChars   = true;
var chatWriteTmpBuffer   = "";
var defaultChatColor     = window.localStorage ? parseInt(localStorage.getItem("chatcolor")) : null; // 24-bit Uint
var chatPageUnreadBar    = null;
var chatGlobalUnreadBar  = null;
var chatGreentext        = true;
var chatEmotes           = true;
var acceptChatDeletions  = true;
var chatEmoteData        = null;
var chatAutocmpMode      = 0;
var chatAutocmpIndex     = null;
var chatAutocmpCount     = null;
var chatAutocmpCursor    = null;
var chatAutocmpOffset    = null;
var client_commands      = {}; // deprecated
var server_commands = [ // taken from /backend/websockets/chat.js
	// operator
	[3, "uptime", null, "get uptime of server", null],

	// superuser
	[2, "worlds", null, "list all worlds", null],

	// staff
	[1, "channel", null, "get info about a chat channel"],

	// general
	[0, "help", null, "list all commands", null],
	
	[0, "block", ["id"], "block someone by id", "1220"],
	[0, "blockuser", ["username"], "block someone by username", "JohnDoe"],
	[0, "unblock", ["id"], "unblock someone by id", "1220"],
	[0, "unblockuser", ["username"], "unblock someone by username", "JohnDoe"],
	[0, "unblockall", null, "unblock all users", null],
	[0, "mute", ["id", "seconds", "[h/d/w/m/y]"], "mute a user completely", "1220 9999"], // check for permission
	[0, "clearmutes", null, "unmute all clients"], // check for permission
	[0, "delete", ["id", "timestamp"], "delete a chat message", "1220 1693147307895"], // check for permission
	[0, "tell", ["id", "message"], "tell someone a secret message", "1220 The coordinates are (392, 392)"],
	[0, "whoami", null, "display your identity"],
	[0, "test", null, "preview your appearance"]
];


if(isNaN(defaultChatColor)) {
	defaultChatColor = null;
} else {
	if(defaultChatColor < 0) defaultChatColor = 0;
	if(defaultChatColor > 16777215) defaultChatColor = 16777215;
}

defineElements({ // elm[<name>]
	chat_window: byId("chat_window"),
	chat_open: byId("chat_open"),
	chatsend: byId("chatsend"),
	chatbar: byId("chatbar"),
	chat_close: byId("chat_close"),
	page_chatfield: byId("page_chatfield"),
	global_chatfield: byId("global_chatfield"),
	chat_page_tab: byId("chat_page_tab"),
	chat_global_tab: byId("chat_global_tab"),
	usr_online: byId("usr_online"),
	total_unread: byId("total_unread"),
	page_unread: byId("page_unread"),
	global_unread: byId("global_unread"),
	chat_upper: byId("chat_upper"),
	chat_autocomplete_list: byId("chat_autocomplete_list")
});

if(Permissions.can_chat(state.userModel, state.worldModel)) {
	OWOT.on("chat", function(e) {
		w.emit("chatMod", e);
		if(e.hide) return;
		event_on_chat(e);
	});
}

if(state.userModel.is_staff) {
	elm.chatbar.maxLength = 3030*2;
} else {
	elm.chatbar.maxLength = 400*2; // Doubled for surrogates; an event listener will truncate it to 400 characters
}

var canChat = Permissions.can_chat(state.userModel, state.worldModel);
if(!canChat) {
	selectedChatTab = 1;
	elm.chat_window.style.display = "none";
} else {
	elm.chat_open.style.display = "";
}

if(state.worldModel.no_chat_global) {
	elm.chat_page_tab.style.display = "none";
	elm.chat_global_tab.style.display = "none";
	elm.usr_online.style.paddingLeft = "0px";
	elm.chat_upper.style.textAlign = "center";
}

function api_chat_send(message, opts) {
	if(!message) return;
	if(!opts) opts = {};

	var event = {
		message: message,
		opts: opts,
		cancel: false
	};

	w.emit("chatSend", event);
	message = event.message;

	if (event.cancel) return;
	if(!message) return;

	var exclude_commands = opts.exclude_commands;
	var nick = opts.nick || YourWorld.Nickname || state.userModel.username;
	var location = opts.location ? opts.location : (selectedChatTab == 0 ? "page" : "global");
	var customMeta = opts.customMeta;

	var msgLim = state.userModel.is_staff ? 3030 : 400;

	message = message.trim();
	if(!message.length) return;
	message = [...message].slice(0, msgLim).join("");
	chatWriteHistory.push(message);
	if(chatWriteHistory.length > chatWriteHistoryMax) {
		chatWriteHistory.shift();
	}
	chatWriteHistoryIdx = -1;
	chatWriteTmpBuffer = "";

	var chatColor;
	if(!opts.color) {
		if(!YourWorld.Color) {
			chatColor = assignColor(nick);
		} else {
			chatColor = "#" + ("00000" + YourWorld.Color.toString(16)).slice(-6);
		}
	} else {
		chatColor = opts.color;
	}

	if(!exclude_commands && message.startsWith("/")) {
		var args = message.substr(1).split(" ");
		var command = args[0].toLowerCase();
		args.shift();
		if(client_commands.hasOwnProperty(command)) {
			client_commands[command](args);
			return;
		}
	}

	network.chat(message, location, nick, chatColor, customMeta);
}

function clientChatResponse(message) {
	addChat(null, 0, "user", "[ Client ]", message, "Client", false, false, false, null, getDate());
}

// important - use the w.chat.registerCommand function
function register_chat_command(command, callback, params, desc, example) {
	chatCommandRegistry[command.toLowerCase()] = {
		callback,
		params,
		desc,
		example
	};
	// client_commands may be deprecated in the future
	client_commands[command.toLowerCase()] = callback;
}

register_chat_command("nick", function (args) {
	var newDisplayName = args.join(" ");
	if(!newDisplayName) {
		newDisplayName = "";
	}
	var nickLim = state.userModel.is_staff ? Infinity : 40;
	newDisplayName = [...newDisplayName].slice(0, nickLim).join("");
	YourWorld.Nickname = newDisplayName;
	storeNickname();
	var nickChangeMsg;
	if(newDisplayName) {
		nickChangeMsg = "Set nickname to `" + newDisplayName + "`";
	} else {
		nickChangeMsg = "Nickname reset";
	}
	clientChatResponse(nickChangeMsg);
}, ["nickname"], "change your nickname", "JohnDoe");

register_chat_command("ping", function() {
	var pingTime = getDate();
	network.ping(function(resp, err) {
		if(err) {
			return clientChatResponse("Ping failed");
		}
		var pongTime = getDate();
		var pingMs = pongTime - pingTime;
		clientChatResponse("Ping: " + pingMs + " MS");
	});
}, null, "check the latency", null);

register_chat_command("gridsize", function (args) {
	var size = args[0];
	if(!size) size = "10x18";
	size = size.split("x");
	var width = parseInt(size[0]);
	var height = parseInt(size[1]);
	if(!width || isNaN(width) || !isFinite(width)) width = 10;
	if(!height || isNaN(height) || !isFinite(height)) height = 18;
	if(width < 4) width = 4;
	if(width > 160) width = 160;
	if(height < 4) height = 4;
	if(height > 144) height = 144;
	defaultSizes.cellW = width;
	defaultSizes.cellH = height;
	updateScaleConsts();
	w.reloadRenderer();
	clientChatResponse("Changed grid size to " + width + "x" + height);
}, ["WxH"], "change the size of cells", "10x20");

register_chat_command("color",  function(args) {
	var color = args.join(" ");
	color = resolveColorValue(color);
	YourWorld.Color = color;
	clientChatResponse("Changed text color to #" + ("00000" + YourWorld.Color.toString(16)).slice(-6).toUpperCase());
}, ["color code"], "change your text color", "#FF00FF");

register_chat_command("chatcolor", function(args) {
	var color = args.join(" ");
	if(!color) {
		localStorage.removeItem("chatcolor");
		defaultChatColor = null;
		clientChatResponse("Chat color reset");
	} else {
		defaultChatColor = resolveColorValue(color);
		localStorage.setItem("chatcolor", defaultChatColor);
		clientChatResponse("Changed chat color to #" + ("00000" + defaultChatColor.toString(16)).slice(-6).toUpperCase());
	}
}, ["color code"], "change your chat color", "#FF00FF");

register_chat_command("warp", function(args) {
	var address = args[0];
	if(!address) address = "";
	positionX = 0;
	positionY = 0;
	writeBuffer = [];
	tellEdit = [];
	resetUI();
	stopPasting();
	if(address.charAt(0) == "/") address = address.substr(1);
	state.worldModel.pathname = address ? "/" + address : "";
	ws_path = createWsPath();
	w.changeSocket(ws_path, true);
	getWorldProps(address, "props", function(props, error) {
		if(!error) {
			reapplyProperties(props);
		}
	});
	clientChatResponse("Switching to world: \"" + address + "\"");
}, ["world"], "go to another world", "forexample");

register_chat_command("night", function() {
	w.night();
}, null, "enable night mode", null);

register_chat_command("day", function() {
	w.day(true);
}, null, "disable night mode", null);

register_chat_command("clear", function() {
	if(selectedChatTab == 0) {
		for(var i = 0; i < chatRecordsPage.length; i++) {
			var rec = chatRecordsPage[i];
			rec.element.remove();
		}
		chatRecordsPage.splice(0);
	} else if(selectedChatTab == 1) {
		for(var i = 0; i < chatRecordsGlobal.length; i++) {
			var rec = chatRecordsGlobal[i];
			rec.element.remove();
		}
		chatRecordsGlobal.splice(0);
	}
}, null, "clear all chat messages locally", null);

register_chat_command("stats", function() {
	network.stats(function(data) {
		var stat = "Stats for world:\n";
		stat += "Creation date: " + convertToDate(data.creationDate) + "\n";
		stat += "View count: " + data.views;
		clientChatResponse(stat);
	});
}, null, "view stats of a world", null);

function sendChat() {
	var chatText = elm.chatbar.value;
	elm.chatbar.value = "";
	var opts = {};
	if(defaultChatColor != null) {
		opts.color = "#" + ("00000" + defaultChatColor.toString(16)).slice(-6);
	}
	api_chat_send(chatText, opts);
}

function updateUnread() {
	var total = elm.total_unread;
	var page = elm.page_unread;
	var global = elm.global_unread;
	var totalCount = chatPageUnread + chatGlobalUnread;
	total.style.display = "none";
	global.style.display = "none";
	page.style.display = "none";
	if(totalCount) {
		total.style.display = "";
		total.innerText = totalCount > 99 ? "99+" : "(" + totalCount + ")";
	}
	if(chatOpen) { // don't want to stretch tab width before it's initially calculated
		if(chatPageUnread) {
			page.style.display = "";
			page.innerText = chatPageUnread > 99 ? "99+" : "(" + chatPageUnread + ")";
		}
		if(chatGlobalUnread) {
			global.style.display = "";
			global.innerText = chatGlobalUnread > 99 ? "99+" : "(" + chatGlobalUnread + ")";
		}
	}
}

function event_on_chat(data) {
	if((!chatOpen || selectedChatTab == 1) && data.location == "page") {
		chatPageUnread++;
	}
	if((!chatOpen || selectedChatTab == 0) && data.location == "global" && !state.worldModel.no_chat_global) {
		chatGlobalUnread++;
	}
	updateUnread();
	addChat(data.location, data.id, data.type,
		data.nickname, data.message, data.realUsername, data.op, data.admin, data.staff, data.color, data.date || Date.now(), data.dataObj);
}

elm.chatsend.addEventListener("click", function() {
	sendChat();
});

function moveCaretEnd(elm) {
	if(elm.selectionStart != void 0) {
		elm.selectionStart = elm.value.length;
		elm.selectionEnd = elm.value.length;
	} else if(elm.createTextRange != void 0) {
		elm.focus();
		var range = elm.createTextRange();
		range.collapse(false);
		range.select();
	}
}

function setChatTabPadding(elm) {
	var width = elm.offsetWidth;
	if(!width) return;
	width += 16 * 2;
	elm.style.minWidth = width + "px";
}

elm.chatbar.addEventListener("keydown", function(e) {
	var keyCode = e.keyCode;
	// scroll through chat history that the client sent
	if(keyCode == 38 && chatAutocmpMode != 1) { // up
		// history modified
		if(chatWriteHistoryIdx > -1 && elm.chatbar.value != chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1]) {
			chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1] = elm.chatbar.value;
		}
		if(chatWriteHistoryIdx == -1 && elm.chatbar.value) {
			chatWriteTmpBuffer = elm.chatbar.value;
		}
		chatWriteHistoryIdx++;
		if(chatWriteHistoryIdx >= chatWriteHistory.length) chatWriteHistoryIdx = chatWriteHistory.length - 1;
		var upVal = chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1];
		if(!upVal) return;
		elm.chatbar.value = upVal;
		// pressing up will move the cursor all the way to the left by default
		e.preventDefault();
		moveCaretEnd(elm.chatbar);
	} else if(keyCode == 40 && chatAutocmpMode != 1) { // down
		// history modified
		if(chatWriteHistoryIdx > -1 && elm.chatbar.value != chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1]) {
			chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1] = elm.chatbar.value;
		}
		chatWriteHistoryIdx--;
		if(chatWriteHistoryIdx < -1) {
			chatWriteHistoryIdx = -1;
			return;
		}
		var str = "";
		if(chatWriteHistoryIdx != -1) {
			str = chatWriteHistory[chatWriteHistory.length - chatWriteHistoryIdx - 1];
		} else {
			if(chatWriteTmpBuffer) {
				str = chatWriteTmpBuffer;
				e.preventDefault();
				moveCaretEnd(elm.chatbar);
			}
		}
		elm.chatbar.value = str;
		e.preventDefault();
		moveCaretEnd(elm.chatbar);
	} else if((e.key == "Enter" || keyCode == 13) && (chatAutocmpMode != 1 || e.shiftKey)) { // Enter
		sendChat();
		if(chatAutocmpMode != 0) hideAutocomplete();
	} else if((keyCode == 38 || keyCode == 40) && chatAutocmpMode == 1) { // Up & Down 
		elm.chat_autocomplete_list.querySelectorAll(".option")[chatAutocmpIndex].classList.remove("selected");
		chatAutocmpIndex = chatAutocmpIndex + (keyCode == 38 ? -1 : 1);
		if(keyCode == 38 && chatAutocmpIndex < 0) chatAutocmpIndex = chatAutocmpCount - 1;
		if(keyCode == 40 && chatAutocmpIndex > chatAutocmpCount - 1) chatAutocmpIndex = 0;
		elm.chat_autocomplete_list.querySelectorAll(".option")[chatAutocmpIndex].classList.add("selected");
		e.preventDefault();
	} else if((keyCode == 9 || keyCode == 13) && chatAutocmpMode == 1) { // Tab & Enter
		autofillResult(elm.chat_autocomplete_list.querySelectorAll(".option")[chatAutocmpIndex]);
		e.preventDefault();
	} else if((keyCode == 9 && chatAutocmpMode == 2) || (keyCode == 27 && chatAutocmpMode != 0)) { // Tab or Escape
		hideAutocomplete();
	}
});

elm.chatbar.addEventListener("input", function() {
	var msgLim = state.userModel.is_staff ? 3030 : 400;
	if([...elm.chatbar.value].length > msgLim) {
		elm.chatbar.value = [...elm.chatbar.value].slice(0, msgLim).join("");
	}
});

function createEmoteImage(emoteName) {
  var position = emoteList[emoteName];
  var ePosX = position[0] / 2;
  var ePosY = position[1] / 2;
  var eWidth = (position[2] ?? 32) / 2;
  return "<div title=':" + emoteName
    + ":' class='chat_emote' style='background-position-x:-" + ePosX
    + "px;background-position-y:-" + ePosY
    + "px;width:" + eWidth + "px'></div>";
}

function makeCommandList() {
	var commandList = {};
	for(var i in chatCommandRegistry) {
		commandList[i] = {
			description: chatCommandRegistry[i].desc,
			parameters: chatCommandRegistry[i].params,
			example: chatCommandRegistry[i].example,
		}
	}

	for(var i in server_commands) {
		if(server_commands[i][0] == 3 && !state.userModel.is_operator) continue;
		if(server_commands[i][0] == 2 && !state.userModel.is_superuser) continue;
		if(server_commands[i][0] == 1 && !state.userModel.is_staff) continue;
		if((server_commands[i][1] == "mute" || server_commands[i][1] == "clearmutes" || server_commands[i][1] == "delete") && !state.userModel.is_staff && !(state.userModel.is_owner && selectedChatTab == 0)) continue;

		commandList[server_commands[i][1]] = {
			description: server_commands[i][3],
			parameters: server_commands[i][2],
			example: server_commands[i][4],
		}
	}

	return commandList;
}

function showAutocomplete(mode) {
	chatAutocmpMode = mode;
	elm.chat_autocomplete_list.style.display = "block";
	elm.chat_autocomplete_list.style.bottom = (elm.chatbar.offsetHeight + 2) + "px";
	elm.chat_autocomplete_list.style.right = (elm.chat_upper.offsetWidth - 3 - elm.chatbar.offsetWidth) + "px";
	elm.chat_autocomplete_list.style.maxHeight = "calc((100% - " + (elm.chat_upper.offsetHeight + elm.chatbar.offsetHeight + 5) + "px) * 0.667)";
}

function hideAutocomplete() {
	if(chatAutocmpMode == 0) return;
	elm.chat_autocomplete_list.style.display = "none";
	chatAutocmpMode = 0;
	chatAutocmpIndex = null;
	chatAutocmpCount = null;
	chatAutocmpCursor = null;
	chatAutocmpOffset = null;
}

function autofillResult(element) {
	var val = elm.chatbar.value;
	var att = element.getAttribute("data-content");
	if(att.startsWith("/") && att.endsWith(" ")) {
		var commandList = makeCommandList();
		if(commandList[att.slice(1, att.length-1)] && commandList[att.slice(1, att.length-1)].parameters == null) {
			sendChat();
			hideAutocomplete();
			return;
		}
	}
	elm.chatbar.value = val.slice(0, chatAutocmpCursor - chatAutocmpOffset) + att + val.slice(chatAutocmpCursor, val.length);
	hideAutocomplete();
}

function addEmoteAutosuggestOption(emote, highlight) {
	if(chatAutocmpCount == null) chatAutocmpCount = 0;
	chatAutocmpCount++;
	var option = document.createElement("div");
	option.classList.add("option");
	option.innerHTML = createEmoteImage(emote) + " :<b>" + html_tag_esc(emote.slice(0, highlight)) + "</b>" + html_tag_esc(emote.slice(highlight, emote.length)) + ":";
	option.setAttribute("data-content", ":" + emote + ":");
	option.addEventListener("click", function() {
		autofillResult(this);
		elm.chatbar.focus();
	});
	if(chatAutocmpCount == 1) option.classList.add("selected");
	elm.chat_autocomplete_list.appendChild(option);
}

function addCommandAutosuggestOption(name, parameters, description, highlight, paramIndex) {
	if(chatAutocmpCount == null) chatAutocmpCount = 0;
	chatAutocmpCount++;
	var option = document.createElement("div");
	option.classList.add("option");
	if(highlight != null && paramIndex == null) {
		option.innerHTML = "<span style=\"color: #00006f;\">/<b>" + html_tag_esc(name.slice(0, highlight)) + "</b>" + html_tag_esc(name.slice(highlight, name.length))
        + "</span>" + (parameters != null ? " <span style=\"font-style: italic;\">&lt;" + html_tag_esc(parameters.join(", ")) + "&gt;</span>" : "")
        + "<span> :: " + html_tag_esc(description) + "</span>";
		option.setAttribute("data-content", "/" + name + " ");
		option.addEventListener("click", function() {
			autofillResult(this);
			elm.chatbar.focus();
		});
		if(chatAutocmpCount == 1) option.classList.add("selected");
	} else if(highlight == null && paramIndex != null) {
		var paramString = "";
		for(var i in parameters) {
			paramString += (i == paramIndex ? "<b>" : "") + html_tag_esc(parameters[i]) + (i == paramIndex ? "</b>" : "") + (i != parameters.length-1 ? ", " : "");
		}
		option.innerHTML = "<span style=\"color: #00006f;\">/" + html_tag_esc(name) + "</span>" + (parameters != null ? " <span style=\"font-style: italic;\">&lt;" + paramString + "&gt;</span>" : "")
        + "<span> :: " + html_tag_esc(description) + "</span>";
	}
	elm.chat_autocomplete_list.appendChild(option);
}

elm.chatbar.addEventListener("selectionchange", function() {
	if(this.selectionStart != this.selectionEnd) {
		hideAutocomplete();
		return;
	}

	if(this.value.startsWith("/")) {
		var currentCommand = this.value.slice(1, this.value.length).toLowerCase().split(" ")[0];
		var commandList = makeCommandList();

		if(this.value.split(" ").length == 1) {
			chatAutocmpCursor = this.selectionStart;
			chatAutocmpOffset = currentCommand.length + 1;
			chatAutocmpIndex = 0;
			chatAutocmpCount = 0;
			var commandArr = Object.keys(commandList).sort();
		
			elm.chat_autocomplete_list.innerHTML = "";
			var foundCommands = false;
			for(var i in commandArr) {
				if(commandArr[i].toLowerCase().startsWith(currentCommand)) {
					addCommandAutosuggestOption(commandArr[i], commandList[commandArr[i]].parameters, commandList[commandArr[i]].description, currentCommand.length, null)
					foundCommands = true;
			    }
			}
		
			if(!foundCommands) {
				hideAutocomplete();
			} else {
				showAutocomplete(1);
				return;
			}
		} else {
			if(Object.keys(commandList).includes(currentCommand) && commandList[currentCommand].parameters && commandList[currentCommand].parameters.length >= this.value.split(" ").length-1) {
				elm.chat_autocomplete_list.innerHTML = "";
				addCommandAutosuggestOption(currentCommand, commandList[currentCommand].parameters, commandList[currentCommand].description, null, this.value.split(" ").length-2);
				showAutocomplete(2);
				return;
			} else {
				hideAutocomplete();
			}
		}
	}

	var matches = [...this.value.slice(0, this.selectionStart).matchAll(/(?<!:[a-z0-9_]+):[a-z0-9_]*$/giu)];
	if(matches.length == 0) {
		hideAutocomplete();
		return;
	}
	
	var currentEmote = matches[matches.length-1][0].trim().toLowerCase();
	currentEmote = currentEmote.slice(1, currentEmote.length);
	chatAutocmpCursor = this.selectionStart;
	chatAutocmpOffset = currentEmote.length + 1;
	chatAutocmpIndex = 0;
	var emoteArr = Object.keys(emoteList).sort();

	elm.chat_autocomplete_list.innerHTML = "";
	var foundEmotes = false;
	for(var i = 0; emoteArr.length > i; i++) {
		if(emoteArr[i].toLowerCase().startsWith(currentEmote)) {
			addEmoteAutosuggestOption(emoteArr[i], currentEmote.length)
			foundEmotes = true;
		}
	}

	if(!foundEmotes) {
		hideAutocomplete();
		return;
	}
	showAutocomplete(1);
});

elm.chat_close.addEventListener("click", function() {
	w.emit("chatClose");
	elm.chat_window.style.display = "none";
	elm.chat_open.style.display = "";
	chatOpen = false;
});

elm.chat_open.addEventListener("click", function() {
	w.emit("chatOpen");
	elm.chat_window.style.display = "";
	elm.chat_open.style.display = "none";
	chatOpen = true;
	if(selectedChatTab == 0) {
		insertNewChatElements();
		chatPageUnread = 0;
		if(!initPageTabOpen) {
			initPageTabOpen = true;
			elm.page_chatfield.scrollTop = elm.page_chatfield.scrollHeight;
		}
	} else {
		insertNewChatElements();
		chatGlobalUnread = 0;
		if(!initGlobalTabOpen) {
			initGlobalTabOpen = true;
			elm.global_chatfield.scrollTop = elm.global_chatfield.scrollHeight;
		}
	}
	var chatWidth = chat_window.offsetWidth - 2;
	var chatHeight = chat_window.offsetHeight - 2;
	var screenRatio = window.devicePixelRatio;
	if(!screenRatio) screenRatio = 1;
	var virtWidth = owotWidth / screenRatio;
	if(chatWidth > virtWidth) {
		resizeChat(virtWidth - 2, chatHeight);
	}
	if(!initChatOpen) {
		initChatOpen = true;
		setChatTabPadding(elm.chat_page_tab);
		setChatTabPadding(elm.chat_global_tab);
	}
	updateUnread();
});

elm.chat_page_tab.addEventListener("click", function() {
	elm.chat_page_tab.classList.add("chat_tab_selected");
	elm.chat_global_tab.classList.remove("chat_tab_selected");

	elm.global_chatfield.style.display = "none";
	elm.page_chatfield.style.display = "";
	selectedChatTab = 0;
	chatPageUnread = 0;

	insertNewChatElements();
	updateUnread();
	if(!initPageTabOpen) {
		initPageTabOpen = true;
		elm.page_chatfield.scrollTop = elm.page_chatfield.scrollHeight;
	}
});

elm.chat_global_tab.addEventListener("click", function() {
	elm.chat_global_tab.classList.add("chat_tab_selected");
	elm.chat_page_tab.classList.remove("chat_tab_selected");

	elm.global_chatfield.style.display = "";
	elm.page_chatfield.style.display = "none";
	selectedChatTab = 1;
	chatGlobalUnread = 0;

	insertNewChatElements();
	updateUnread();
	if(!initGlobalTabOpen) {
		initGlobalTabOpen = true;
		elm.global_chatfield.scrollTop = elm.global_chatfield.scrollHeight;
	}
});

function resizable_chat() {
	var state = 0;
	var isDown = false;
	var downX = 0;
	var downY = 0;
	var elmX = 0;
	var elmY = 0;
	var chatWidth = 0;
	var chatHeight = 0;
	chat_window.addEventListener("mousemove", function(e) {
		if(isDown) return;
		var posX = e.pageX - chat_window.offsetLeft;
		var posY = e.pageY - chat_window.offsetTop;
		var top = (posY) <= 4;
		var left = (posX) <= 3;
		var right = (chat_window.offsetWidth - posX) <= 4;
		var bottom = (chat_window.offsetHeight - posY) <= 5;
		var cursor = "";
		if(left || right) cursor = "ew-resize";
		if(top || bottom) cursor = "ns-resize";
		if((top && left) || (right && bottom)) cursor = "nwse-resize";
		if((bottom && left) || (top && right)) cursor = "nesw-resize";
		chat_window.style.cursor = cursor;
		state = bottom << 3 | right << 2 | left << 1 | top;
	});
	chat_window.addEventListener("mousedown", function(e) {
		downX = e.pageX;
		downY = e.pageY;
		if(state) {
			// subtract 2 for the borders
			chatWidth = chat_window.offsetWidth - 2;
			chatHeight = chat_window.offsetHeight - 2;
			elmX = chat_window.offsetLeft;
			elmY = chat_window.offsetTop;
			isDown = true;
			chatResizing = true;
		}
	});
	document.addEventListener("mouseup", function(e) {
		isDown = false;
		chatResizing = false;
		if(!closest(e.target, elm.chat_autocomplete_list)) hideAutocomplete();
	});
	document.addEventListener("mousemove", function(e) {
		if(!isDown) return;
		var offX = e.pageX - downX;
		var offY = e.pageY - downY;
		var resize_bottom = state >> 3 & 1;
		var resize_right = state >> 2 & 1;
		var resize_left = state >> 1 & 1;
		var resize_top = state & 1;

		var width_delta = 0;
		var height_delta = 0;
		var abs_top = chat_window.offsetTop;
		var abs_left = chat_window.offsetLeft;
		var snap_bottom = chat_window.style.bottom == "0px";
		var snap_right = chat_window.style.right == "0px";

		if(resize_top) {
			height_delta = -offY;
		} else if(resize_bottom) {
			height_delta = offY;
		}
		if(resize_left) {
			width_delta = -offX;
		} else if(resize_right) {
			width_delta = offX;
		}
		var res = resizeChat(chatWidth + width_delta, chatHeight + height_delta);
		if(resize_top && !snap_bottom) {
			chat_window.style.top = (elmY + (chatHeight - res[1])) + "px";
		}
		if(resize_bottom && snap_bottom) {
			chat_window.style.bottom = "";
			chat_window.style.top = abs_top + "px";
		}
		if(resize_right && snap_right) {
			chat_window.style.right = "";
			chat_window.style.left = abs_left + "px";
		}
		if(resize_left && !snap_right) {
			chat_window.style.left = (elmX + (chatWidth - res[0])) + "px";
		}
	});
}

function evaluateChatfield(chatfield) {
	var field;
	if(chatfield == "page") {
		field = elm.page_chatfield;
	} else if(chatfield == "global") {
		field = elm.global_chatfield;
	} else {
		field = getChatfield();
	}
	return field;
}

// a lookup table between the emote name and its atlas location
var emoteList = {
	// blobs
	"OHHELLNO": [0, 0],
	"ohno": [32, 0],
	"notcool": [64, 0],
	"bad": [96, 0],
	"bruh": [128, 0],
	"huh": [160, 0],
	"derp": [192, 0],
	"heh": [224, 0],
	"lol": [256, 0],
	"neat": [288, 0],
	"awesome2": [320, 0],
	"beepboop": [352, 0],
	"erhb": [384, 0],
	"what": [416, 0],
	"zzz": [448, 0],
	"shock": [480, 0],
	"glare": [512, 0],
	"watchyotone": [544, 0],
	"blob_pride": [576, 0],
	"blob_ally": [608, 0],
	"blob_trans": [640, 0],
	// 16px faces
	"ded": [0, 32],
	"mad": [32, 32],
	"sad": [64, 32],
	"areyoukidding": [96, 32],
	"sadsmug": [128, 32],
	"ouch": [160, 32],
	"meh": [192, 32],
	"okthen": [224, 32],
	"void": [256, 32],
	"teef": [288, 32],
	"mmm": [320, 32],
	"durr": [352, 32],
	"lenny": [384, 32],
	"smug": [416, 32],
	"oOoo": [448, 32],
	"chaos": [480, 32],
	"bootiful": [512, 32],
	"omg": [544, 32],
	"stahp": [576, 32],
	"thinq": [608, 32],
	"thunk": [640, 32],
	"cringe": [672, 32],
	// miscellaneous
	"yeesh": [0, 64],
	"aaaHD": [32, 64],
	"403": [64, 64, 39],
	"awesome": [103, 64],
	"catthinkaaa": [135, 64, 45],
	"like": [180, 64, 31],
	"dislike": [211, 64, 31],
	"failwhale": [242, 64, 70],
	"karp": [312, 64, 35],
	"no": [347, 64],
	"scruffy": [379, 64, 38],
	"tri": [417, 64, 34],
	"troll": [451, 64],
	"critter": [483, 64, 41],
	"ballcat": [524, 64, 28],
	"wart": [552, 64],
	"catspeak": [584, 64],
	"horsespeak": [616, 64, 30],
	"fireboard": [646, 64],
	// fp
	"fp": [0, 96],
	"fpthinkaaa": [32, 96],
	"fplikeaaa": [64, 96],
	"fpdislikeaaa": [96, 96],
	"fppinchaaa": [128, 96]
};

w.on("chatMod", function(e) {
	if(e.id !== 0) return;
	if(e.realUsername != "[ Server ]") return;
	if(e.message.startsWith("Command")) {
		var cmdList = [];
		var htmlResp = "";
		var remoteCmdList = e.message.split("\n");
		var head = remoteCmdList[0];

		htmlResp += head + "<br>";
		htmlResp += "<div style=\"background-color: #DADADA; font-family: monospace; font-size: 13px;\">";

		var cmdIdx = 0;
		for(var i = 1; i < remoteCmdList.length; i++) {
			var line = remoteCmdList[i];
			if(!line.startsWith("/")) continue;
			line = line.split(" -> ");
			var cmdRaw = line[0].split(" ");
			var params = cmdRaw[1];
			var command = cmdRaw[0].slice(1);
			if(params) {
				params = params.slice(1, -1).split(",");
			}
			var descRaw = line[1];
			var exampleStartIdx = descRaw.indexOf("(");
			var example = "";
			if(exampleStartIdx > -1) {
				example = descRaw.slice(exampleStartIdx + 1, -1); // remove parentheses
				descRaw = descRaw.slice(0, exampleStartIdx - 1);
				example = example.split(" ").slice(1).join(" ");
			}

			cmdList.push({
				command: command,
				params: params,
				desc: descRaw,
				example: example
			});
		}

		for(var cmd in chatCommandRegistry) {
			var cliCmd = chatCommandRegistry[cmd];
			cmdList.push({
				command: cmd,
				params: cliCmd.params,
				desc: cliCmd.desc,
				example: cliCmd.example
			});
		}

		cmdList.sort(function(a, b) {
			return a.command.localeCompare(b.command);
		});

		for(var i = 0; i < cmdList.length; i++) {
			var info = cmdList[i];
			var command = info.command;
			var params = info.params;
			var example = info.example;
			var desc = info.desc;

			// display command parameters
			var param_desc = "";
			if(params) {
				param_desc += html_tag_esc("<");
				for(var v = 0; v < params.length; v++) {
					var arg = params[v];
					param_desc += "<span style=\"font-style: italic\">" + html_tag_esc(arg) + "</span>";
					if(v != params.length - 1) {
						param_desc += ", ";
					}
				}
				param_desc += html_tag_esc(">");
			}

			var exampleElm = "";
			if(example && params) {
				example = "/" + command + " " + example;
				exampleElm = "title=\"" + html_tag_esc("Example: " + example) +"\"";
			}

			command = "<span " + exampleElm + "style=\"color: #00006F\">" + html_tag_esc(command) + "</span>";

			var help_row = html_tag_esc("-> /") + command + " " + param_desc + " :: " + html_tag_esc(desc);

			// alternating stripes
			if(cmdIdx % 2 == 1) {
				help_row = "<div style=\"background-color: #C3C3C3\">" + help_row + "</div>";
			}

			htmlResp += help_row;
			cmdIdx++;
		}
		htmlResp += "</div>";

		e.message = htmlResp;
		// upgrade permissions to allow display of HTML
		e.op = true;
		e.admin = true;
		e.staff = true;
	}
});

/*
	[type]:
	* "user"	  :: registered non-renamed nick
	* "anon_nick" :: unregistered nick
	* "anon"	  :: unregistered
	* "user_nick" :: registered renamed nick
*/
function addChat(chatfield, id, type, nickname, message, realUsername, op, admin, staff, color, date, dataObj) {
	if(!dataObj) dataObj = {};
	if(!message) message = "";
	if(!realUsername) realUsername = "";
	if(!nickname) nickname = realUsername;
	if(!color) color = assignColor(nickname);
	var field = evaluateChatfield(chatfield);
	var msgData = {
		id, type, nickname, message, realUsername, op, admin, staff, color, date, dataObj
	};
	if(field == elm.page_chatfield) {
		chatAdditionsPage.push(msgData);
		if(chatAdditionsPage.length > chatHistoryLimit) {
			chatAdditionsPage.shift();
		}
	} else if(field == elm.global_chatfield) {
		chatAdditionsGlobal.push(msgData);
		if(chatAdditionsGlobal.length > chatHistoryLimit) {
			chatAdditionsGlobal.shift();
		}
	}
	insertNewChatElements();
}

function buildChatElement(field, id, type, nickname, message, realUsername, op, admin, staff, color, date, dataObj) {
	var dateStr = "";
	if(date) dateStr = convertToDate(date);
	var pm = dataObj.privateMessage;
	var isGreen = false;

	if(chatGreentext && message[0] == ">" && !(":;_-".includes(message[1]))) { // exception to some emoticons
		message = message.substr(1);
		isGreen = true;
	}

	if(chatLimitCombChars) {
		message = filterChatMessage(message);
		nickname = filterChatMessage(nickname);
	}

	if(!op) {
		message = html_tag_esc(message, false, true);
		nickname = html_tag_esc(nickname, false, true);
	}

	// do not give the tag to [ Server ]
	var hasTagDom = (op || admin || staff || dataObj.rankName) && !(!id && op);

	var tagDom;
	var nickTitle = [];
	var usernameHasSpecialChars = false;

	for(var i = 0; i < realUsername.length; i++) {
		if(realUsername.charCodeAt(i) > 256) {
			usernameHasSpecialChars = true;
			break;
		}
	}

	if(type == "user" || type == "user_nick") {
		nickTitle.push("ID " + id);
	}

	if(hasTagDom) {
		tagDom = document.createElement("span");
		if(dataObj.rankName) {
			tagDom.innerHTML = "(" + dataObj.rankName + ")";
			tagDom.style.color = dataObj.rankColor;
			tagDom.style.fontWeight = "bold";
			nickTitle.push(dataObj.rankName);
		} else if(op) {
			tagDom.innerHTML = "(OP)";
			tagDom.style.color = "#0033cc";
			tagDom.style.fontWeight = "bold";
			nickTitle.push("Operator");
		} else if(admin) {
			tagDom.innerHTML = "(A)";
			tagDom.style.color = "#FF0000";
			tagDom.style.fontWeight = "bold";
			nickTitle.push("Administrator");
		} else if(staff) {
			tagDom.innerHTML = "(M)";
			tagDom.style.color = "#009933";
			tagDom.style.fontWeight = "bold";
			nickTitle.push("Staff");
		}
		tagDom.innerHTML += "&nbsp;";
	}

	var idTag = "";

	var nickDom = document.createElement("a");
	nickDom.style.textDecoration = "underline";

	if(type == "user") {
		nickDom.style.color = color;
		if(!usernameHasSpecialChars) {
			nickDom.style.fontWeight = "bold";
		}
		nickDom.style.pointerEvents = "default";
		if(state.userModel.is_operator) idTag = "[" + id + "]";
	}
	if(type == "anon_nick") {
		idTag = "[*" + id + "]"
	}
	if(type == "anon") {
		idTag = "[" + id + "]"
	}
	if(type == "user_nick") {
		nickDom.style.color = color;
		var impersonationWarning = "";
		if(usernameHasSpecialChars) {
			impersonationWarning = " (Special chars)";
		}
		nickTitle.push("Username \"" + realUsername + "\"" + impersonationWarning);
		if(state.userModel.is_operator) idTag = "[*" + id + "]";
	}

	if(state.userModel.is_operator) {
		idTag = "<span style=\"color: black; font-weight: normal;\">" + idTag + "</span>"
	}

	if(idTag && type != "anon") idTag += "&nbsp;"; // space between id and name

	if(id == 0) {
		idTag = "";
		nickname = "<span style=\"background-color: #e2e2e2;\">" + nickname + "</span>";
	}

	nickname = idTag + nickname;

	if(dateStr) nickTitle.push("(" + dateStr + ")");

	nickDom.innerHTML = nickname + (pm == "to_me" ? "" : ":");
	if(nickTitle.length) nickDom.title = nickTitle.join("; ");

	var pmDom = null;
	if(pm) {
		pmDom = document.createElement("div");
		pmDom.style.display = "inline";
		if(pm == "to_me") {
			pmDom.innerText = " -> Me:";
		} else if(pm == "from_me") {
			pmDom.innerText = "Me -> ";
		}
	}

	if(isGreen) {
		message = "<span style=\"color: #789922\">&gt;" + message + "</span>";
	}

	// parse emoticons
	if(chatEmotes) {
		var emoteMessage = "";
		var emoteBuffer = "";
		var emoteMode = false;
		var emoteCharset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
		// emotes are case sensitive
		for(var i = 0; i < message.length; i++) {
			var chr = message[i];
			if(chr == ":") {
				if(emoteBuffer == ":" && emoteMode) { // special case: two consecutive colons
					emoteMessage += emoteBuffer;
					continue;
				}
				emoteBuffer += chr;
				if(emoteMode) {
					var emoteName = emoteBuffer.slice(1, -1);
					if(emoteList.hasOwnProperty(emoteName)) {
						emoteMessage += createEmoteImage(emoteName);
					} else {
						emoteMessage += emoteBuffer;
					}
					emoteMode = false;
					emoteBuffer = "";
				} else {
					emoteMode = true;
				}
			} else if(emoteMode) {
				emoteBuffer += chr;
				if(!emoteCharset.includes(chr)) {
					emoteMode = false;
					emoteMessage += emoteBuffer;
					emoteBuffer = "";
					continue;
				}
			} else {
				emoteMessage += chr;
			}
		}
		if(emoteBuffer) { // leftovers
			emoteMessage += emoteBuffer;
		}
		message = emoteMessage;
	}

	var msgDom = document.createElement("span");
	msgDom.innerHTML = "&nbsp;" + message;

	var maxScroll = field.scrollHeight - field.clientHeight;
	var scroll = field.scrollTop;
	var doScrollBottom = false;
	if(maxScroll - scroll < 20) { // if scrolled at least 20 pixels above bottom
		doScrollBottom = true;
	}

	var chatGroup = document.createElement("div");
	chatGroup.setAttribute("data-id", id);
	chatGroup.setAttribute("data-date", date);
	if(!pm && hasTagDom) chatGroup.appendChild(tagDom);
	if(pmDom) {
		if(pm == "to_me") {
			if(hasTagDom) chatGroup.appendChild(tagDom);
			chatGroup.appendChild(nickDom);
			chatGroup.appendChild(pmDom);
		} else if(pm == "from_me") {
			chatGroup.appendChild(pmDom);
			if(hasTagDom) chatGroup.appendChild(tagDom);
			chatGroup.appendChild(nickDom);
		}
	} else {
		chatGroup.appendChild(nickDom);
	}
	chatGroup.appendChild(msgDom);

	field.appendChild(chatGroup);

	maxScroll = field.scrollHeight - field.clientHeight;
	if(doScrollBottom) {
		field.scrollTop = maxScroll;
	}

	var chatRec = {
		id: id, date: date,
		field: field,
		element: chatGroup
	};
	if(field == elm.page_chatfield) {
		chatRecordsPage.push(chatRec);
	} else if(field == elm.global_chatfield) {
		chatRecordsGlobal.push(chatRec);
	}
	if(chatRecordsPage.length > chatHistoryLimit) { // overflow on current page
		var rec = chatRecordsPage.shift();
		rec.element.remove();
	}
	if(chatRecordsGlobal.length > chatHistoryLimit) { // overflow on global
		var rec = chatRecordsGlobal.shift();
		rec.element.remove();
	}
}

function insertNewChatElementsIntoChatfield(chatfield, messageQueue) {
	for(var i = 0; i < messageQueue.length; i++) {
		var message = messageQueue[i];
		buildChatElement(chatfield,
				message.id, message.type, message.nickname, message.message,
				message.realUsername, message.op, message.admin, message.staff,
				message.color, message.date, message.dataObj);
	}
	messageQueue.splice(0);
}

function insertNewChatElements() {
	if(!chatOpen) return;
	if(selectedChatTab == 0) {
		insertNewChatElementsIntoChatfield(elm.page_chatfield, chatAdditionsPage);
	} else if(selectedChatTab == 1) {
		insertNewChatElementsIntoChatfield(elm.global_chatfield, chatAdditionsGlobal);
	}
}

function removeChatByIdAndDate(id, date) {
	if(!acceptChatDeletions) return;
	var records = [chatRecordsPage, chatRecordsGlobal];
	for(var r = 0; r < records.length; r++) {
		var recList = records[r];
		for(var i = 0; i < recList.length; i++) {
			var currentRec = recList[i];
			if(currentRec.id == id && currentRec.date == date) {
				var elm = currentRec.element;
				elm.remove();
			}
		}
	}
}

function addUnreadChatBar(chatfield, message, checkSituation) {
	var field = evaluateChatfield(chatfield);
	if(checkSituation) {
		var maxScroll = field.scrollHeight - field.clientHeight;
		var scroll = field.scrollTop;
		var remScroll = maxScroll - scroll;
		if(chatfield == "page") {
			if(chatPageUnreadBar || selectedChatTab == 0) return;
		}
		if(chatfield == "global") {
			if(chatGlobalUnreadBar || selectedChatTab == 1) return;
		}
	}
	var msg = "New messages";
	if(message) msg = message;
	var bar = document.createElement("div");
	var barText = document.createElement("span");
	bar.className = "unread_bar";
	barText.className = "unread_bar_msg";
	barText.innerText = msg;
	bar.appendChild(barText);
	field.appendChild(bar);
	return bar;
}

function isLongWidthChar(x) {
	return [
		3061, 11835, 65021, 73776, 73795, 73807, 74017, 
		74022, 74059, 74060, 74065, 74265, 74382, 74588, 
		74611, 74788, 74791, 74792, 74793, 74794, 74795, 
		74798, 74801,
		43461
	].includes(x);
}

function filterChatMessage(str) {
	if(typeof str != "string") return "";
	var res = "";
	var longWidthLimit = 1;
	var diacriticLength = 0;
	var longWidthCount = 0;
	str = [...str];
	for(var i = 0; i < str.length; i++) {
		var chr = str[i];
		var code = chr.codePointAt();
		var isLong = isLongWidthChar(code);
		if(isLong) {
			if(longWidthCount >= longWidthLimit) {
				res += ".";
			} else {
				res += chr;
				longWidthCount++;
			}
		} else {
			res += chr;
		}
		diacriticLength = 0;
	}
	return res;
}

function getChatfield() {
	if(selectedChatTab == 0) {
		return elm.page_chatfield;
	} else if(selectedChatTab == 1) {
		return elm.global_chatfield;
	}
}

function updateUserCount() {
	var count = w.userCount;
	if(count == void 0) {
		elm.usr_online.innerText = "";
		return;
	}
	var unit = "user";
	var units = "users";
	var current_unit;
	if(count == 1) {
		current_unit = unit;
	} else {
		current_unit = units;
	}
	elm.usr_online.innerText = count + " " + current_unit + " online";
}

function chatType(registered, nickname, realUsername) {
	var nickMatches = (nickname + "").toUpperCase() == (realUsername + "").toUpperCase();
	var hasSpecialChars = false;
	if(realUsername == "[ Server ]") return "user";
	if(nickname) {
		for(var i = 0; i < nickname.length; i++) {
			if(nickname.charCodeAt(i) > 256) {
				hasSpecialChars = true;
				break;
			}
		}
	}
	if(registered && (nickMatches || !nickname)) {
		if(hasSpecialChars) {
			return "user_nick";
		} else {
			return "user";
		}
	}
	if(registered && !nickMatches) return "user_nick";
	if(!registered && !nickname) return "anon";
	if(!registered && nickname) return "anon_nick";
	return type;
}
