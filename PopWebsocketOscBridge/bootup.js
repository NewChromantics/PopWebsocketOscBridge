Pop.Include = function(Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun( Source, Filename );
}

Pop.Include('PromiseQueue.js');

const Window = new Pop.Gui.Window("Websocket OSC bridge");


const Label = new Pop.Gui.Label(Window,[0,0,900,900]);
Label.SetValue("Hello");



const OldDebug = Pop.Debug;
const DebugLog = [];
const MaxDebugLogLength = 50;
Pop.Debug = function()
{
	const DebugString = [...arguments].join(',');
	DebugLog.splice(0,0,DebugString);
	DebugLog.splice(MaxDebugLogLength,DebugLog.length);
	
	//	update label
	Label.SetValue(DebugLog.join('\n'));
	
	//	print out stll
	//OldDebug( ...arguments );
	OldDebug( DebugString );
}

//	todo: promise queue with buffer
const OscToWebsocketQueue = new PromiseQueue();
const WebsocketToOscQueue = new PromiseQueue();

async function WaitForOscToWebsocketMessage()
{
	//	get new promise from queue
	return OscToWebsocketQueue.Allocate();
}

async function WaitForWebsocketToOscMessage()
{
	//	get new promise from queue
	return WebsocketToOscQueue.Allocate();
}

function SendWebsocketToOscMessage(Message)
{
	Pop.Debug(`Websocket: ${Message}`);
	//	put in queue
	WebsocketToOscQueue.Resolve(Message);
}

function SendOscToWebsocketMessage(Message)
{
	Pop.Debug(`OSC: ${Message}`);
	//	put in queue
	OscToWebsocketQueue.Resolve(Message);
}

async function WebsocketServerLoop(GetListenPort,OnRecvMessage,WaitForSendMessage)
{
	while(true)
	{
		const Port = GetListenPort();
		try
		{
			const Server = new Pop.Websocket.Server(Port);
			//await Server.WaitForConnect();
			Pop.Debug(`Webocket listening ${Port}; from`, JSON.stringify(Server.GetAddress()));
			
			const SendLoop = async function()
			{
				while ( true )
				{
					const Message = await WaitForSendMessage();
					const Peers = Server.GetPeers();
					function Send(Peer)
					{
						Server.Send( Peer, Message );
					}
					Peers.forEach(Send);
				}
			}
			let SendError = null;
			//	start the send loop
			SendLoop().then().catch( e => SendError = e );
			
			while ( true )
			{
				const Message = await Server.WaitForMessage();
				OnRecvMessage(Message);
				
				if ( SendError )
					throw SendError;
			}
		}
		catch(e)
		{
			Pop.Debug(`Websocket[${Port}] loop error; ${e}`);
			await Pop.Yield(1000);
		}
	}
}


async function UdpClientLoop(GetConnectAddress,OnRecvMessage,WaitForSendMessage)
{
	while(true)
	{
		const Address = GetConnectAddress();
		try
		{
			const Client = new Pop.Socket.UdpClient(...Address);
			await Client.WaitForConnect();
			Pop.Debug(`Udp connected ${Address}; from`, JSON.stringify(Client.GetAddress()));
			
			const SendLoop = async function()
			{
				while ( true )
				{
					const Message = await WaitForSendMessage();
					const Peers = Server.GetPeers();
					function Send(Peer)
					{
						Server.Send( Peer, Message );
					}
					Peers.forEach(Send);
				}
			}
			let SendError = null;
			//	start the send loop
			SendLoop().then().catch( e => SendError = e );
			
			while ( true )
			{
				const Message = await Client.WaitForMessage();
				OnRecvMessage(Message);
				
				if ( SendError )
					throw SendError;
			}
		}
		catch(e)
		{
			Pop.Debug(`udp[${Address}] loop error; ${e}`);
			await Pop.Yield(1000);
		}
	}
}

function GetNextWebsocketPort()
{
	return 8080;
}

function GetNextUdpAddress()
{
	return ['localhost',63803];
}



WebsocketServerLoop(GetNextWebsocketPort,SendWebsocketToOscMessage,WaitForOscToWebsocketMessage).then(Pop.Debug).catch(Pop.Debug);
UdpClientLoop(GetNextUdpAddress,SendOscToWebsocketMessage,WaitForWebsocketToOscMessage).then(Pop.Debug).catch(Pop.Debug);

