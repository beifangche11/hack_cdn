var express = require('express')
var static = require('node-static');
var http = require('http');
var app = express();
var server = http.createServer(app);
var os = require('os');
var io = require('socket.io').listen(server);
var stats = require('measured').createCollection();

// express 设置
app.set('port', (process.env.PORT || 5000))
app.use(express.static(__dirname + '/public'))
app.use('/css', express.static(__dirname + '/css'))
app.use('/src', express.static(__dirname + '/src'))

var file = new(static.Server)();
app.get('/', function(request, response) {
  file.serve(request, response);
})

server.listen(app.get('port'), function() {
    console.log("Node app is running at localhost:" + app.get('port'))
})

// 服务器端对象，用于存客户端的信息
var rtc = {};

// 存放所有建立的连接
var allClients = [];

// 当客户端和服务端建立连接
io.sockets.on('connection', function (socket){
    
    // 将当前连接信息放到存放所有连接的数组中
    allClients.push(socket);

    // 通用log打印
    function log(){
		var array = [">>> Message from server:"];
        array.push.apply(array, arguments);
	    socket.emit('log', array);
	}

    // 断开某个连接
    function disconnect(id, list) {
        // 从list中移除socketid
        list.splice(list.indexOf(id), 1);

        // 遍历list中的每个socketid
        for (var j = 0; j < list.length; j++) {

            console.log(list[j]);

            var sock;

            // 遍历当前建立的连接
            for (var k = 0; k < allClients.length; k++) {
                
                sock = allClients[k];

                // 确认这个连接还没有被关闭
                if (list[j] === sock.id) {
                    break;
                }
            }

            // 如果有没有断开的连接，则发通知断开
            if (sock) {
                sock.emit("remove_peer", id);
            }
        }
    }

    // 接受到消息后进行广播
	socket.on('message', function (message) {
		log('Client said:', message);
		socket.broadcast.emit('message', message);
	});

    // 当有通信建立或者加入，创建一个房间
	socket.on('create or join', function (room) {
		var numClients = io.sockets.clients(room).length;
		log('Room ' + room + ' has ' + numClients + ' client(s)');

        // 如果这个房间不存在，创建一个新的房间对象
        rtc[room] = rtc[room] || {"total": [], "initiators": []};

        // 每个房间的连接id
        var connectionIds = [];
        
        // 如果当前房间有资源请求的人
        if (rtc[room].initiators.length) {
            
            var id = socket.id;

            while (id === socket.id) {
                // 获取发起者id
                var randomId = Math.floor(Math.random()*rtc[room].initiators.length)
                id = rtc[room].initiators[randomId];
            }
            // 将发起者id存储房间的连接数组中
            connectionIds.push(id);
            var sock;
            //在建立连接的id中找发起者的id
            for (var j = 0; j < allClients.length; j++) {
                sock = allClients[j];
                if (id === sock.id) {
                    break;
                }
            }
            // 如果找到了发起者的id，广播发现了新的节点
            if (sock) {
                // let everyone know about the join
                sock.emit("new_peer", socket.id);
            }
        }

        
        log("get_peers", connectionIds, socket.id);
        // 对外发送所有建立连接的新节点
        socket.emit("get_peers", connectionIds, socket.id);

        // 如果当前房间没有别的节点，将当前节点加入房间，并对外广播此节点创建了新的房间
		if (numClients === 0){
			socket.join(room);
			socket.emit('created', room, socket.id);
		// 如果房间已经被创建，则新节点加入房间，发送它准备好了
        } else  {
			socket.join(room);
            socket.emit('joined', room, socket.id);
            io.sockets.in(room).emit('ready');
		}

        // 将所有节点记录一下，用于建立数据通道
        rtc[room].total.push(socket.id)
        log("Our current RTC object: " + JSON.stringify(rtc));
	});

    // 当Socket从另一个浏览器下载数据时
    socket.on('downloaded', function (room) {

        log('Socket', socket.id, "in room", room, "has finished downloading");

        // 发起下载的这个Socket现在是发起者，也可以提供资源
        rtc[room].initiators.push(socket.id);
        log("Our current RTC object: " + JSON.stringify(rtc));
    });

    // 从客户端接受数据，并向另一个浏览器转发
    socket.on('bytes_received', function (room, time) {
        // 更新数据
        socket.broadcast.emit('update_graph', time)
    });

    // 当一个socket从服务断开时
    socket.on('disconnect', function() {
        
        // 找到这个断开的socket，并将其从所有活动的socket中删除
        var i = allClients.indexOf(socket);

        allClients.splice(i, 1);

        var room;
        // 将此socket从全部socket和发起者socket中删除
        for (var key in rtc) {

            room = rtc[key];

            var exist_total = room.total.indexOf(socket.id);
            var exist_init = room.initiators.indexOf(socket.id);
            
            if (exist_total !== -1 || exist_init !== -1) {

                if (exist_total !== -1) {
                    disconnect(socket.id, room.total);
                }
                if (exist_init !== -1) {
                    disconnect(socket.id, room.initiators);
                }
                break;
            }
        }
        
        console.info("Server side clean!");

    });
});