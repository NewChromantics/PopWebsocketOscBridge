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

function EncodeOscMessage(Address,Floats,Ints)
{
	let Packet = [];
	
	function Pad()
	{
		//	OSC packets need to be multiples of 32bit
		while( (Packet.length % 4 ) != 0 )
			Packet.push(0);
	}
	
	function Finish()
	{
		//	seems Protokol (not sure about spec) needs at least one terminator
		if ( Packet[Packet.length-1] != 0 )
			Packet.push(0);
		
		Pad();
	}
	
	function AppendString(Str)
	{
		for ( let i = 0; i < Str.length; i++)
		{
			const Char = Str.charCodeAt(i);
			Packet.push(Char);
		}
		Packet.push(0);
		Pad();
	}
	
	function AppendFloat(Float)
	{
		const Arrayf = new Float32Array(1);
		Arrayf[0] = Float;
		const Array8 = new Uint8Array(Arrayf.buffer);
		Packet.push(Array8[3]);
		Packet.push(Array8[2]);
		Packet.push(Array8[1]);
		Packet.push(Array8[0]);
		Pad();
	}
	
	function AppendInt(Float)
	{
		const Arrayf = new Int32Array(1);
		Arrayf[0] = Float;
		const Array8 = new Uint8Array(Arrayf.buffer);
		Packet.push(Array8[3]);
		Packet.push(Array8[2]);
		Packet.push(Array8[1]);
		Packet.push(Array8[0]);
		Pad();
	}
	
	//	turn this input into an OSC packet
	if ( Address[0] != '/' )
		throw `OSC address doesn't start with /: ${Address}`;
	AppendString(Address);
	
	Floats = Floats || [];
	Ints = Ints || [];

	if ( Floats.length || Ints.length )
	{
		let Types = ',';
		for ( let i=0;	i<Floats.length;	i++ )
			Types += 'f';
		for ( let i=0;	i<Ints.length;	i++ )
			Types += 'i';
		AppendString(Types);
		
		for ( let i=0;	i<Floats.length;	i++ )
			AppendFloat(Floats[i]);
		for ( let i=0;	i<Ints.length;	i++ )
			AppendInt(Ints[i]);
	}
	
	/*
	 AppendString(',i');
	 Packet.push(0);
	 Packet.push(0);
	 Packet.push(1);
	 Packet.push(1);
	 */
	//AppendString(',f');
	//AppendFloat(123.45);
	
	Finish();
	//	put in queue
	Packet = new Uint8Array(Packet);
	return Packet;
}

function SendWebsocketToOscMessage(Message)
{
	let Object = JSON.parse(Message.Data);
	if ( !Object.Address )
		throw `Websocket message ${Message.Data} missing .Address`;
	
	if ( Object.Address[0] != '/' )
		Object.Address = '/' + Object.Address;
	
	//const Packet = EncodeOscMessage('/foo',[123.45],[1,2,3]);
	const Packet = EncodeOscMessage(Object.Address,Object.Floats,Object.Ints);
	//Pop.Debug("Websocket message",Message.Data);
	WebsocketToOscQueue.Resolve(Packet);
}

async function FloodTest()
{
	while (true)
	{
		await Pop.Yield(1000);
		const Osc = {};
		Osc.Address = '/hello';
		Osc.Value = '1';
		SendWebsocketToOscMessage(Osc);
	}
}
//FloodTest().then().catch(Pop.Debug);
				

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
			const Socket = new Pop.Websocket.Server(Port);
			//await Socket.WaitForConnect();
			Pop.Debug(`Webocket listening ${Port}; from`, JSON.stringify(Socket.GetAddress()));
			
			const SendLoop = async function()
			{
				while ( true )
				{
					const Message = await WaitForSendMessage();
					const Peers = Socket.GetPeers();
					function Send(Peer)
					{
						Socket.Send( Peer, Message );
					}
					Peers.forEach(Send);
				}
			}
			let SendError = null;
			//	start the send loop
			SendLoop().then().catch( e => SendError = e );
			
			while ( true )
			{
				const Message = await Socket.WaitForMessage();
				try
				{
					OnRecvMessage(Message);
				}
				catch(e)
				{
					const Error = {};
					Error.Error = e;
					Pop.Debug(`Sending error ${e} back to peer ${Message.Peer}`);
					Socket.Send(Message.Peer,JSON.stringify(Error));
				}
					
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
			const Socket = new Pop.Socket.UdpClient(...Address);
			await Socket.WaitForConnect();
			Pop.Debug(`Udp connected ${Address}; from`, JSON.stringify(Socket.GetAddress()));
			
			const SendLoop = async function()
			{
				while ( true )
				{
					const Message = await WaitForSendMessage();
					const Peers = Socket.GetPeers();
					Pop.Debug(`Sending ${Message} to Peers ${Peers}`);
					function Send(Peer)
					{
						try
						{
							const Type = typeof Message;
							Pop.Debug(`Sending ${Message}(${Type}) to ${Peer}`);
							Socket.Send( Peer, Message );
						}
						catch(e)
						{
							Pop.Debug(`Send error ${e}`);
						}
					}
					Peers.forEach(Send);
				}
			}
			let SendError = null;
			//	start the send loop
			SendLoop().then().catch(Pop.Debug);// e => SendError = e );
			
			while ( true )
			{
				const Message = await Socket.WaitForMessage();
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
	return ['localhost',9999];//63803];
}



WebsocketServerLoop(GetNextWebsocketPort,SendWebsocketToOscMessage,WaitForOscToWebsocketMessage).then(Pop.Debug).catch(Pop.Debug);
UdpClientLoop(GetNextUdpAddress,SendOscToWebsocketMessage,WaitForWebsocketToOscMessage).then(Pop.Debug).catch(Pop.Debug);

