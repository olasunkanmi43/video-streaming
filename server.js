var express = require("express");

var app = express();

var http = require("http").createServer(app);

var mongodb = require("mongodb");
var mongoClient = mongodb.MongoClient;
var ObjectId = mongodb.ObjectId;

var bodyParser = require("body-parser");
var bcrypt = require("bcrypt");

var formidable = require("formidable");
var fileSystem = require("fs");
var { getVideoDurationInSeconds } = require("get-video-duration");

var expressSession = require("express-session");


app.use(expressSession({
    "key": "user_id",
    "secret": "User secret Object Id",
    "resave": true,
    "saveUninitialized": true
}));

// A FUNCTION TO RETURN USER'S DOCUMENT
function getUser (id, callBack) {
    database.collection("users").findOne({
        "_id": ObjectId(id)
    }, function (error, user) {
        callBack(user);
    });
}

app.use(bodyParser.json({
    limit: "10000mb"
}));
app.use(bodyParser.urlencoded({
    extended: true,
    limit: "10000mb",
    parameterLimit: 1000000
}));

app.use("/public", express.static(__dirname + "/public"));
app.set("view engine", "ejs");

http.listen(3000, function () {
    console.log("Server Started.");

    mongoClient.connect("mongodb://localhost:27017", function (error, client) {
        database = client.db("my_video_streaming");
       
        app.get("/", function(req, res) {

            database.collection("videos").find({}).sort({
                "createdAt": -1
            }).toArray(function (error, videos) {
                res.render("index", {
                    "isLogin": req.session.user_id ? true : false,
                    "videos": videos
                });
            });
            });
            
    
        app.get("/signup", function (req, res) {
            res.render("signup");
        });
        
        app.post("/signup", function (req, res) {

            //CHECK IF EMAIL ALREADY EXISTS
            database.collection("users").findOne({
                "email": req.body.email
            }, function (error, user) {
                if (user == null) {
                    //NOT EXISTS

                    //CONVERT PASSWORD TO HASH
                    bcrypt.hash(req.body.password, 10, function (error, hash) {
                        database.collection("users").insertOne({
                            "name": req.body.name,
                            "email": req.body.email,
                            "password": hash,
                            "coverPhoto": "",
                            "image": "",
                            "subscribers": 0,
                            "subscriptions": [], //CHANNELS I HAVE SUBSCRIBED
                            "playlists": [],
                            "videos": [],
                            "history": [],
                            "notifications": []
                        }, function (error, data) {
                            res.redirect("/login");
                        });
                    });
                } else {
                    // EXISTS
                    res.send("Email already exists")
                }
            });
        });

        app.get("/login", function (req, res) {
            res.render("login", {
                "error": "",
                "message": ""
            });
        });

        app.post("/login", function (req, res) {
            //CHECK IF EMAIL EXISTS

            database.collection("user").findOne({
                "email": req.body.email
            }, function (error, user) {
                if (user == null) {
                    res.send("Email does not exists");
                } else {
                    //COMPARE HASHED PASSWORD
                    bcrypt.compare(req.body.password, user.password, function (
                        error, isVerify) {
                            if(isVerify) {
                                // SAVE USER ID IN SESSION
                                req.session.user_id = user._id;
                                res.redirect("/");
                            } else {
                                res.send("Password is not correct");
                            }
                        });
                }
            });
        });

        app.get("logout", function (req, res) {
            req.session.destroy();
            res.redirect("/");
        });

        app.get("/upload", function (req, res) {
            if (req.session.user_id) {
                //CREATE NEW PAGE FOR UPLOAD
                res.render("upload", {
                    "isLogin": true
                });
            } else {
                res.redirect("/login");
            }
        });

        app.post("/upload-video", function (req, res) {
            // CHECK IF USER IS LOGGED IN
            if (req.session.user_id) {

                var formData = new formidable.IncomingForm();
                formData.maxFileSize = 1000 * 1024 * 1024;
                formData.parse(req, function (error, fields, files) {
                    var title = fields.title;
                    var description = fields.description;
                    var tags = fields.tags;
                    var category = fields.category;

                    var oldPathThumbnail = files.thumbnail.path;
                    var thumbnail = "public/thumbnails/" + new Date().getTime() + "-" + files.thumbnail.name;

                    fileSystem.rename(oldPathThumbnail, thumbnail, function (error) {
                        //
                    });

                    var oldPathVideo = files.video.path;
                    var newPath = "public/videos/" + new Date().getTime() + "-" + files.video.name;

                    fileSytem.rename(oldPathVideo, newPath, function (error) {
                        // GET USER DATA TO SAVE IN VIDEOS DOCUMENT

                        getUser(req.session.user_id, function (user) {
                            var currentTime = new Date().getTime();

                            // GET VIDEO DURATION
                            getVideoDurationInSeconds(newPath).then(function(duration) {
                                var hours = Math.floor(duration / 60 / 60);
                                var minutes = Math.floor(duration / 60) - (hours * 60);
                                var seconds = Math.floor(duration % 60);

                                // INSERT IN DATABASE

                                database.collection("videos").insertOne({
                                    'user': {
                                        "_id": user._id,
                                        "name": user.name,
                                        "image": user.image,
                                        "subscribers": user.subscribers,
                                    },
                                    "filePath": newPath,
                                    "thumbnail": thumbnail,
                                    "title": title,
                                    "description": description,
                                    "tags": tags,
                                    "category": category,
                                    "createdAt": currentTime,
                                    "minutes": minutes,
                                    "seconds": seconds,
                                    "hours": hours,
                                    "watch": currentTime,
                                    "views": 0,
                                    "playlist": "",
                                    "likers": [],
                                    "dislikers": [],
                                    "comments": []
                                }, function (error, data) {
                                    // INSERT IN USERS COLLECTION TOO
                                    database.collection("users").updateOne({
                                        "_id": ObjectId(req.session.user_id)
                                    }, {
                                        $push: {
                                            "videos": {
                                                "_id": data.insertedId,
                                                "title": title,
                                                "views": 0,
                                                'thumbnail': thumbnail,
                                                "watch": currentTime
                                            }
                                        }
                                    });

                                    res.redirect("/");
                                });
                            });
                        });
                    });
                });

            } else {
                res.redirect("/login");
            }
        });

        app.get("/watch/:watch", function (req, res) {
            database.collection("videos").findOne({
                "watch": parseInt(req.params.watch)
            }, function (error, video) {
                if (video == null) {
                    res.send("Video does not exists");
                } else {

                    // INCREMENT VIEWS COUNTER
                    database.collection('videos').updateOne({
                        "_id": ObjectId(video._id)
                    }, {
                        $inc: {
                            "views": 1
                        }
                    });

                    res.render("video-page/index", {
                        "isLogin": req.session.user_id ? true : false,
                        "video": video
                    });
                }
            });
        });

        app.post("/do-like", function(req, res) {
            if (req.session.user_id) {
                // CHECK IF ALREADY LIKED

                database.collection("videos").findOne({
                    $and: [{
                    "_id": ObjectId(req.body.videoId),
                    }, {
                    "likers._id": req.session.user_id
                }]
                }, function (error, video) {
                    if (video == null) {
                        // PUSH IN LIKERS ARRAY

                        database.collection("videos").updateOne({
                            "_id": ObjectId(req.body.videoId)
                        }, {
                            $push: {
                                "likers": {
                                    "_id": req.session.user_id
                                }
                            }
                        }, function (error, data) {
                            res.json({
                                "status": "success",
                                "message": "Video has been liked"
                            });
                        });

                    } else {
                        res.json({
                            "status": "error",
                            "message": "Already liked this video"
                        });
                    }
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login"
                });
            }
        });

        app.post("/do-dislike", function(req, res) {
            if (req.session.user_id) {
                // CHECK IF ALREADY DISLIKED

                database.collection("videos").findOne({
                    $and: [{
                    "_id": ObjectId(req.body.videoId),
                    }, {
                    "dislikers._id": req.session.user_id
                }]
                }, function (error, video) {
                    if (video == null) {
                        // PUSH IN DISLIKERS ARRAY

                        database.collection("videos").updateOne({
                            "_id": ObjectId(req.body.videoId)
                        }, {
                            $push: {
                                "dislikers": {
                                    "_id": req.session.user_id
                                }
                            }
                        }, function (error, data) {
                            res.json({
                                "status": "success",
                                "message": "Video has been disliked"
                            });
                        });

                    } else {
                        res.json({
                            "status": "error",
                            "message": "Already disliked this video"
                        });
                    }
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login"
                });
            }
        });

        app.post("/do-comment", function (req, res) {
            if (req.session.user_id) {

                getUser(req.session.user_id, function (user) {
                    database.collection("videos").findOneAndUpdate({
                        "_id": ObjectId(req.body.videoId)
                    }, {
                        $push: {
                            "comments": {
                                "_id": ObjectId(),
                                "user": {
                                    "_id": user._id,
                                    "name": user.name,
                                    "image": user.image
                                },
                                "comment": req.body.comment,
                                "createdAt": new Date().getTime(),
                                "replies": []
                            }
                        }
                    }, function (error, data) {
                        //SEND NOTIFICATION TO VIDEO PUBLISHER

                        var channelId = data.value.user._id;
                        database.collection("user").updateOne({
                            "_id": ObjectId(channelId)
                        }, {
                            $push: {
                                "notifications": {
                                    "_id": ObjectId(),
                                    "type": "new_comment",
                                    "content": req.body.comment,
                                    "is_read": false,
                                    "video_watch": data.value.watch,
                                    "user": {
                                        "_id": user._id,
                                    "name": user.name,
                                    "image": user.image
                                    }
                                }
                            }
                        });

                        res.json({
                            "status": "success",
                            "message": "Comment has been posted",
                            "user": {
                                "_id": user._id,
                                    "name": user.name,
                                    "image": user.image
                            }
                        });
                    });
                });

            } else {
                res.json({
                    "status": "error",
                    "message": "Please login"
                }); 
            }
        });

        app.get("/get_user", function (req, res) {
            if (req.session.user_id) {
                getUser(req.session.user_id, function (user) {
                    delete user.password;

                    res.json({
                        "status": "success",
                        "message": "Record has been fetched",
                        "user": user
                     });
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
            }
        });

        app.post("/read-notification", function (req, res) {
            if (req.session.user_id) {
                database.collection("users").updateOne({
                    $and: [{
                        "_id": ObjectId(req.session.user_id)
                    }, {
                        "notifications._id": ObjectId(req.body.notificationId)
                    }]
                }, {
                    $set: {
                        "notifications.$.is_read": true
                    }
                }, function (error1, data) {
                    res.json({
                        "status": "success",
                        "message": "Notification has been marked as read"
                    });
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
            }
        });

        app.post("/do-reply", function (req, res) {
            if (req.session.user_id) {
                var reply = req.body.reply;
                var commendId = req.body.commentId;

                getUser(req.session.user_id, function (user) {
                    database.collection("videos").findOneAndUpdate({
                        "comments._id": ObjectId(commentId)
                    }, {
                        $push: {
                            "comments.$.replies": {
                                "_id": ObjectId(),
                                "user": {
                                    "_id": user._id,
                                    "name": user.name,
                                    "image": user.image
                                },
                                "reply": reply,
                                "createdAt": new Date().getTime()
                            }
                        }
                    }, function (error1, data) {

                        var videoWatch = data.value.watch;
                        for (var a = 0; a < data.value.comments.length; a++) {
                            var comment = data.value.comments[a];

                            if (comment._id == commentId) {
                                var _id = comment.user._id;

                                database.collection("users").updateOne({
                                    "_id": ObjectId(id)
                                }, {
                                    $push: {
                                        "nofications": {
                                            "_id": ObjectId(),
                                            "type": "new_reply",
                                            "content": reply,
                                            "is_read": false,
                                            "video-watch": videoWatch,
                                            "user": {
                                                "_id": user._id,
                                                "name": user.name,
                                                "image": user.image
                                            }
                                        }
                                    }
                                });
                                break;
                            }
                        }

                        res.json({
                            "status": "success",
                            "message": "Reply has been posted",
                            "user": {
                                "_id": user._id,
                                "name": user.name,
                                "image": user.image
                            }
                        });
                    });
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
            }
        });

        app.post("/do-subscribe", function(req, res) {
            if (req.session.user_id) {
                database.collection("videos").findOne({
                    "_id": ObjectId(req.body.videoId)
                }, function (error1, video) {
                    if (req.session.user_id == video.user._id) {
                        res.json({
                            "status": "error",
                            "message": "You cannot subscribe on your channel"
                        });
                    } else {

                        // CHECK IF CHANNEL IS ALREADY SUBSCRIBED

                        getUser(req.session.user_id, function (myData) {
                            var flag = false;
                            for (var a = 0; a < myData.subscriptions.length; a++) {
                                if (myData.subscriptions[a]._id.toString() == video.user._id.toString()) {
                                    flag = true;
                                    break;
                                }
                            }

                            if (flag) {
                                res.json({
                                    "status": "error",
                                    "message": "Already subscribed"
                                });
                            } else {

                                database.collection("users").findOneAndUpdate({
                                    "_id": video.user._id
                                }, {
                                    $inc: {
                                        "subscribers": 1
                                    }
                                }, {
                                    returnOriginal: false
                                }, function (error2, userData) {

                                    database.collection("users").updateOne({
                                        "_id": ObjectId(res.session.user_id)
                                    }, {
                                        $push: {
                                            "subscriptions": {
                                                "_id": video.user._id,
                                                "name": video.user.name,
                                                "subscribers": userData.value.subscribers,
                                                "image": userData.value.image
                                            }
                                        }
                                    }, function (error3, data) {

                                        database.collection("videos").findOneAndUpdate({
                                            "_id": ObjectId(req.body.videoId)
                                        }, {
                                            $inc: {
                                                "user.subscriber": 1
                                            }
                                        });

                                        res.json({
                                            "status": "success",
                                            "message": "Subscription has been added"
                                        });
                                    });
                                });
                            }
                        });
                    } 
                });
            } else {
                res.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
            }
        });
    });
 });

    