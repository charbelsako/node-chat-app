let express = require('express')
let app = express()
let server = require('http').createServer(app)
let io = require('socket.io').listen(server)
let mongoose = require('mongoose')
//can't really implement text messages now, no api allows it
let users = {}

server.listen(3000)
console.log('Server running...')

mongoose.connect('mongodb://localhost/chat')
console.log('mongoDB running...')

//make the user Schema 
let userSchema = mongoose.Schema({
	number: Number,
	username: String,
	password: String,
	contacts: {type: Array, default: [] },
	verification_code: Number,
	verified: {type: Boolean, default: false}
})
//add the model
let User = mongoose.model('User', userSchema)

//make the messages Schema / collection
let msgSchema = mongoose.Schema({
	username: String,
	msg: String,
	created: {type: Date, default: Date.now}
})
//add it as a model
let Msg = mongoose.model('Message', msgSchema)

//make the groups Schema
let groupSchema = mongoose.Schema({
	admin: String,
	members: Array,
	title: String
})
//add the model
let Groups = mongoose.model('Group', groupSchema)

//group messages schema
let g_msg = mongoose.Schema({
	from: String,
	msg: String,
	date: {type: Date, default: Date.now}
})
//add group messages as a model
let group_message = mongoose.model('Group Message', g_msg)

//private messages schema
let p_msg = mongoose.Schema({
	from: String,
	to: String,
	msg: String,
	date: {type: Date, default: Date.now}
})
//add private messages as a model
let Private = mongoose.model('Private Message', p_msg)
/* for actual security add a logged in variable as such */
let logged_in = false //only allow messages to be sent when this variable is true

app.get('/', (req, res) => {
	res.sendFile( __dirname + '/index.html')
})

io.sockets.on('connection', socket => {
	
	//THIS IS THE DISCONNECT THING/FUNCTION/METHOD CODE!
	socket.on('disconnect', (data) => {
		if(!socket.nickname) return
		delete users[socket.nickname]
		updateNicknames()
	})

	//code that takes care of new users
	socket.on('new user', (data,callback) => {
		if(data in users){
			callback(false)
		}else{
			//verification code
			let code = Math.floor(Math.random() * 100000);
			//add the user to mongodb
			let newUser = new User({username: data.username, number: data.number, password: data.password, verification_code: code})
			newUser.save( err => {
				if(err) throw err
				callback(true)
			})
		}
	})

	//this code sends the message	
	socket.on('send message', (data, callback) => {
		let message = data.msg.trim()
		if(message.substring(0,3) === '/w '){
			let msg = message.substring(3)
			let ind = msg.indexOf(' ')
			if(ind != -1){
				let username = msg.substring(0,ind)
				msg = msg.substring(ind + 1)
				if(username in users){
					socket.emit('whisper', {username: username, msg: msg, dir: 'to'})
					users[username].emit('whisper', {username: socket.nickname, msg: msg, dir: 'from'})
				}else{
					callback('username does not exist')
				}
			}else{
				callback('no username')
			}
		}else{
			io.sockets.emit('new message', {msg: message, username: socket.nickname})
		}
	})

	//verify code SOCKET FUNCTION 
	socket.on('verify code', (data,callback)=>{
		console.log('verifying')
		//run a query on mongoDB to get the code of the user and run it against the inputted code then assign a true value to the verified field
		User.find({username: data.username}, (err, doc) => {
			if(err){
				callback(false)
			}else{
				let result = (doc[0].verification_code == data.code)
				if(result){
					User.findOne({ username: data.username }, function (err, doc){
					  doc.verified = true
					  doc.save()
					})
					callback(true)
				}else{
					callback(false)
				}
			}
		})
	})

	//code that handles the login form
	socket.on('login', (data, callback) => {
		//run a query to mongoDB asking to see if there is an account with the given username and pass
		let query = User.find({username: data.username, password: data.password})
		query.exec( (err, user) => {
			if(err){
				console.log(err)
				callback('something went wrong')
			}else{
				//for some reason this code `let u = data.username` was causing errors
				if(user.length > 0){
						if(user[0].verified){
							callback('success')
							socket.nickname = data.username
							users[socket.nickname] = socket
							updateContacts(data.username)
							updateNicknames()
							logged_in = true
						}else{
							callback('your account has not been verified yet')
						}
				}else{
					callback('wrong username or password')
				}
			}

		})
	})

	//code that receives an add contact request and sends it to the specified user
	socket.on('add contact', (data) => {
		users[data].emit('contact request', {to: data, from: socket.nickname})
	})

	//if the user accepts the contact request
	socket.on('accepted contact request', data => {
		users[data.to].emit('request accepted', data.from)
		users[data.from].emit('request accepted', data.to)
		//query mongoDB and add him in the contacts Array
		User.update({username: data.to}, { $push: { contacts: data.from }}, (err, response) => {
			if(err) throw err
			console.log(response)
		})
		User.update({username: data.from}, { $push: { contacts: data.to }}, (err, response) => {
			if(err) throw err
			console.log(response)
		})
		updateContacts(data.from)
		updateContacts(data.to)
	})

	function updateNicknames(){
		io.sockets.emit('usernames', Object.keys(users) )
	}

	function updateContacts(arg){
		//get all the contacts from mongoDB then send it as a variable called "data" (data[0].contacts)
		let query = User.find({username: arg}).select('contacts') 
		query.exec( (err, data) => {
			//the find function returns data in the form of an ARRAY of OBJECTS data[i].key
			console.log(data[0].contacts)
			users[arg].emit('update contacts', data[0].contacts ) /* the data variable here is the users' contacts */	
		})
	}
	//END OF LIFE AS WE KNOW IT
})