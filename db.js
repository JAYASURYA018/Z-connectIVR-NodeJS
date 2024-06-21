const sql = require('mysql2');

const connection=sql.createConnection({
    host:'localhost',
    user:'root',
    password:'1999',
    database:'CallStudio'
})

connection.connect((err)=>{

    if(err){
        console.log("db connection not established",err);
    }else{
        console.log("DB connected successfully");
    }

})
module.exports={connection}