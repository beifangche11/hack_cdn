//  stun server配置
var configuration = {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};

// 客户端id,用于建立数据通道
var my_id;

// 如果用户已经下载了页面资源并可以与新来者启动数据通道，则为true
var isInitiator;

// 构建数据通道的唯一PeerConnection实例
var peerConnections = {};

// 存放已经连接连接的socketid
var connections = [];

// 数据通道
var dataChannels = {};
var currentDataChannel;

// 用于存储资源加载时长
var photoBeganRenderingTime = new Date();
var photoFinishedRenderingTime;

// 存放每个连接加载资源的时间
var connData = [];

// 随机分配的房间
var rooms = [1,2,3]

// 如果用户没有加房间号，随机给分配一个
var room = window.location.hash.substring(1);
if (!room) {
    randomRoom = Math.floor(Math.random()*rooms.length);
    room = window.location.hash = rooms[randomRoom];
}

// 跟踪页面资源是否已下载
var elementHasBeenDownloaded = false; 

// 存储客户端的socket信息
var socket = io.connect();


// if (location.hostname.match(/localhost|127\.0\.0/)) {
//     socket.emit('ipaddr');
// }

// 如果浏览器不支持webrtc，从服务器拉取资源
if (!webrtcDetectedBrowser) {
    isInitiator = true;
    loadFromServer();
}

// 用户第一个进入房间
socket.on('created', function (room, clientId) {
    console.log('Created room', room, '- my client ID is', clientId);
  
    my_id = clientId;
    
    // 允许它的资源被下载
    isInitiator = true;
    loadFromServer();
});


// 计算平均资源加载时间
function avg_array(arr) {
    var sum = 0
    for( var i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum / arr.length;
}

// 发送和接收所有字节后，用资源加载时时间更新
socket.on('update_graph', function (time) {
    connData.push(time);
    // 更新图标
    updateGraph(connData);

    $("#latency_report").css({"display":"block"});
    $("#latency_values").append("<p class='center left'>C" + connData.length + " : " +  time + "ms      |      </p>");
    $("#avg_report").css({"display":"block"});
    $("#num_connections")[0].innerHTML = connData.length;
    $("#avg_latency")[0].innerHTML = avg_array(connData);
});

// 用户创建或者加入了一个房间
socket.emit('create or join', room);

// 客户端加入了一个房间
socket.on('joined', function (room, clientId) {
    console.log('This peer has joined room', room, 'with client ID', clientId, "socket", socket);
    
    my_id = clientId;

    isInitiator = false;

    if (!webrtcDetectedBrowser) {
        loadFromServer();
    }
});

// 打印服务端的日志
socket.on('log', function (array) {
  console.log.apply(console, array);
});

// 在浏览器直接传递数据
socket.on('message', function (message){
    console.log('Client received message:', message);

    // 消息触发处理
    signalingMessageCallback(message);
});

// 让同一个房间的节点建立连接
socket.on('get_peers', function(connectArray, you) {
    my_id = you;

    connections = connectArray;

    createPeerConnections();
    console.log("My connections:", connections, 
                "peerConnections:", peerConnections, 
                "dataChannels:", dataChannels);
});


// 当有新节点加入，将其放入连接数组，并创建一个新的连接
socket.on('new_peer', function(socketId) {
    console.log("new peer");

    connections.push(socketId);

    createPeerConnection(isInitiator, configuration, socketId);
});

// 当一个节点断开连接
socket.on('remove_peer', function(socketId) {
    if (typeof(peerConnections[socketId]) !== 'undefined') {
        peerConnections[socketId].close();
    }
    delete peerConnections[socketId];
    delete dataChannels[socketId];
    delete connections[socketId];
    console.info("Client side clean!");
});

// 更新图表，跟踪每个基于浏览器的连接的资源加载时间
function updateGraph(dataset) {
    dataset = dataset || [100, 200, 300, 400];
    console.log("updating", dataset);

    var w = dataset.length * 25;
    var h = 150;
    var padding = 1;


    var xScale = d3.scale.linear()
                         .domain([0, dataset.length])
                         .range([padding, w - padding * 2]);

    var yScale = d3.scale.linear()
                         .domain([0, d3.max(dataset)/20])
                         .range([h - padding, padding]);

    var xAxis = d3.svg.axis()
                      .scale(xScale)
                      .orient("bottom")
                      .ticks(dataset.length);

    var yAxis = d3.svg.axis()
                      .scale(yScale)
                      .orient("left");

    d3.select("svg").remove();
    var svg = d3.select("body")
        .append("svg")
        .attr("class", "graph")
        .attr("width", w)
        .attr("height", h);
    
    var rects = svg.selectAll("rect")
                .data(dataset)
                .enter()
                .append("rect")
                .attr("x", function(d, i) {
                    return i* (w / dataset.length);
                })
                .attr("y", function(d, i) {
                    return h;
                })
                .attr("width", w / dataset.length - padding)
                .attr("height", 0)
                .attr("fill", function(d) {
                    return "rgb(0, " + Math.floor(d/2000 * 255) + ", 0)";
                }).transition()
                .duration(1000)
                .attr("height", function(d) {
                    return d / 20;
                })
                .attr("y", function(d) {
                    return h - d/20;
                });

    var xAxisLine = svg.append("g")
        .attr("class", "axis")
        .attr("transform", "translate(0," + (h - padding) + ")")
        .attr("stroke", 10)
        .call(xAxis);

    // create Y axis
    svg.append("g")
        .attr("class", "axis")
        .attr("transform", "translate(" + padding + ", 0)")
        .call(yAxis);
}

// 从服务器下载资源
function loadFromServer() {
    // 如果是发起人同时资源已下载
    if (isInitiator && !elementHasBeenDownloaded) {
        $("#downloaded").attr("src", "/sample.jpg");
        // 如果我浏览器支持数据通道，允许其他人从这里下载
        if (webrtcDetectedBrowser) {
            socket.emit('downloaded', room);
        }
        elementHasBeenDownloaded = true

        console.info("****loadFromServer****");

        $("#send_medium")[0].innerHTML = "server";

        $("#downloaded").load(function() {
            photoFinishedRenderingTime = new Date();
            var renderingTime = photoFinishedRenderingTime - photoBeganRenderingTime;
            $("#time_to_load")[0].innerHTML = renderingTime;
        });
    } 
}

// 发消息给服务器 
function sendMessage(message){
    socket.emit('message', message);
}

// 用于建立对等连接
var peerConn;

// 从其他客户端接收到消息时的回调
function signalingMessageCallback(message) {
    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');

        peerConn.setRemoteDescription(new RTCSessionDescription(message), function(){}, logError);
        peerConn.createAnswer(onLocalSessionCreated, logError);
    } else if (message.type === 'answer') {
        console.log('Got answer.');

        peerConn.setRemoteDescription(new RTCSessionDescription(message), function(){}, logError);
    } else if (message.type === 'candidate') {

        peerConn.addIceCandidate(new RTCIceCandidate({
            sdpMLineIndex: message.label,
            sdpMid: message.id,
            candidate: message.candidate
        }));
    } else if (message === 'bye') {
        console.log(message);
    }
}

// 创建同一个房间的所有节点连接
createPeerConnections = function() {
    for (var i = 0; i < connections.length; i++) {
        createPeerConnection(false, configuration, connections[i]);
    }
};

// 创建一个节点连接
function createPeerConnection(isInitiator, config, peer_id) {
    isInitiator = isInitiator || false;
    var being = isInitiator ? "am" : "am not"
    console.log("My id is", my_id, "I", being, " an initiator, and I am creating a PC with", peer_id);
    
    
    peerConn = peerConnections[peer_id] = new RTCPeerConnection(config);

    peerConn.onicecandidate = function (event) {
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate
            });
        } else {
            console.log('End of candidates.');
        }
    };

    // 发起者创建数据通道
    if (isInitiator) {
        console.log("My id is", my_id, "and I am creating a DataChannel with", peer_id);

        dataChannels[peer_id] = peerConn.createDataChannel("photos " + my_id, {reliable: false});
        onDataChannelCreated(dataChannels[peer_id], peer_id);
        console.log('Creating an offer');
        peerConn.createOffer(onLocalSessionCreated, logError);
    } else {
        peerConn.ondatachannel = function (event) {
            // 正在建立数据通道
            dataChannels[peer_id] = event.channel;
            onDataChannelCreated(dataChannels[peer_id], peer_id);
        };
    }
}

// 为节点连接设置本地描述
function onLocalSessionCreated(desc) {
    console.log('local session created:', desc);
    peerConn.setLocalDescription(desc, function () {
        console.log('sending local desc:', peerConn.localDescription);
        sendMessage(peerConn.localDescription);
    }, logError);
}

// 数据通道建立，在两个浏览器间传输数据
function onDataChannelCreated(channel, id) {
    var being = isInitiator ? "am" : "am not"
    console.log("My id is", my_id, "I", being, " an initiator, and I CREATED a DataChannel with", id);

    console.warn("onDataChannelCreated");

    channel.onopen = function () {
        console.warn('Channel opened!');
        if (isInitiator) {
            sendPhoto();
        }
        else {
            $("#send_medium")[0].innerHTML = "browser";
        }
    };

    channel.onerror = function (e) {
        console.log('CHANNEL error!', e);
        // loadFromServer();
    };

    channel.onclose = function() {
        delete dataChannels[id];
        delete peerConnections[id];
        delete connections[id];
        console.info("dataChannel killed on client!");
    };

    channel.onmessage = (webrtcDetectedBrowser == 'firefox') ? 
        receiveDataFirefoxFactory(id) :
        receiveDataChromeFactory(id);
}


// 在chrome上接受数据
function receiveDataChromeFactory(id) {
    var buf, count;

    return function onmessage(event) {
        if (typeof event.data === 'string') {
            buf = window.buf = new Uint8ClampedArray(parseInt(event.data));
            count = 0;
            console.log('Expecting a total of ' + buf.byteLength + ' bytes');
            return;
        }

        var data = new Uint8ClampedArray(event.data);
        buf.set(data, count);

        count += data.byteLength;
        console.log('count: ' + count);

        if (count == buf.byteLength) {
            console.log('Done. Rendering photo.');

            photoFinishedRenderingTime = new Date();
            var renderingTime = photoFinishedRenderingTime - photoBeganRenderingTime;
            $("#time_to_load")[0].innerHTML = renderingTime;

            socket.emit("bytes_received", room, renderingTime);

            renderPhoto(buf);
        }
    }
}

// 在Firefox上接受数据
function receiveDataFirefoxFactory(id) {
    var count, total, parts;

    return function onmessage(event) {
        if (typeof event.data === 'string') {
            total = parseInt(event.data);
            parts = [];
            count = 0;
            console.log('Expecting a total of ' + total + ' bytes');
            return;
        }

        parts.push(event.data);
        count += event.data.size;
        console.log('Got ' + event.data.size + ' byte(s), ' + (total - count) + ' to go.');

        if (count == total) {
            console.log('Assembling payload')

            // 将数据解析为Uint8ClampedArray
            var buf = new Uint8ClampedArray(total);
            var compose = function(i, pos) {
                var reader = new FileReader();
                reader.onload = function() { 
                    buf.set(new Uint8ClampedArray(this.result), pos);
                    if (i + 1 == parts.length) {
                        console.log('Done. Rendering photo.');

                        photoFinishedRenderingTime = new Date();
                        var renderingTime = photoFinishedRenderingTime - photoBeganRenderingTime;
                        $("#time_to_load")[0].innerHTML = renderingTime;
                        
                        // 让服务器知道成功的传输
                        socket.emit("bytes_received", room, renderingTime);
                        
                        renderPhoto(buf);
                    } else {
                        compose(i + 1, pos + this.result.byteLength);
                    }
                };
                reader.readAsArrayBuffer(parts[i]);
            }
            compose(0, 0);
        }
    }
}

// 通过基于浏览器的数据通道发送照片
function sendPhoto() {
    var dcid = connections[Math.floor(Math.random()*connections.length)];
    var dataChannel = dataChannels[Object.keys(dataChannels)[0]];
    console.info("I have chosen dataChannel ", dataChannel, " with id ", dcid);

    currentDataChannel = dcid;

    var CHUNK_LEN = 64000;

    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    var img = document.getElementById('downloaded');
    context.drawImage(img, 0, 0);
    var myData = context.getImageData(0, 0, img.width, img.height);

    var len = myData.data.byteLength,
    n = len / CHUNK_LEN | 0;

    console.log('Sending a total of ' + len + ' byte(s)');
    dataChannel.send(len);

    // 分割照片并发送约64KB的块
    for (var i = 0; i < n; i++) {
        var start = i * CHUNK_LEN,
            end = (i+1) * CHUNK_LEN;
        console.log(start + ' - ' + (end-1));
        dataChannel.send(myData.data.subarray(start, end));
    }

    // 发送提醒
    if (len % CHUNK_LEN) {
        console.log('last ' + len % CHUNK_LEN + ' byte(s)');
        dataChannel.send(myData.data.subarray(n * CHUNK_LEN));
    }
    // dataChannel.close();
    // delete dataChannels[dcid];
    // console.error(dataChannels, dataChannel);
}


// 将画布元素转换为图像
function convertCanvasToImage(canvas) {
    var image = new Image();
    image.src = canvas.toDataURL();
    return image;
}

// 通过将数据写入画布元素并将其转换为img在屏幕上渲染照片
function renderPhoto(data) {
    var photoElt = document.createElement('canvas');
    photoElt.classList.add('photo');
    var ctx = photoElt.getContext('2d');
    ctx.canvas.width  = 499;
    ctx.canvas.height = 374;
    img = ctx.createImageData(499, 374);

    img.data.set(data);
    ctx.putImageData(img, 0, 0);

    $("#downloaded").attr("src", convertCanvasToImage(photoElt).src);
    isInitiator = true;

    socket.emit('downloaded', room);

    dataChannels[Object.keys(dataChannels)[0]].close();
    delete dataChannels[Object.keys(dataChannels)[0]];
    peerConn.close();
}

// 创建RTC对象时的错误回调
function logError(err) {
    console.log(err.toString(), err);
}