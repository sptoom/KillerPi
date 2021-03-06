const uuidv4 = require('uuid/v4')
var models = require('../models')
var mailer = require('../utils/mailer')
var Promise = require('bluebird')
const baseURL = process.env.NODE_KILLER_BASE_URL
const myLog = require('../utils/myLog')

exports.generateContracts = function(gameUuid) {
    var getPlayers = function(){
        return models.Player.findAll({
            where: {
                gameUuid: gameUuid
            }
        })
        .catch(err => {
            myLog.error('contractController: Failed to get players to generate contracts: ' + gameUuid + '\n' + err)
        })
    }

    var getChallenges = function(){
        return models.Challenge.findAll()
        .catch(err => {
            myLog.error('contractController: Failed to get challenges.\n' + err)
        })
    }

    Promise.join(getPlayers(), getChallenges(), function(players, challenges){
        if (players.length > 0 && challenges.length > 0) {
            shuffle(players)
            var i
            for (i = 0; i < players.length; i++) {
                var challengeRandomIndex = Math.floor(Math.random() * challenges.length)
                var challengeUuid = challenges[challengeRandomIndex].uuid
                var killerUuid = players[i].uuid
                var victimUuid = players[(i+1)%players.length].uuid
                exports.createAndSendContract(gameUuid, killerUuid, victimUuid, challengeUuid)
            }
        }
        else {
            myLog.error('contractController: No players or no challenges.')
        }
    })
}

function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex)
        currentIndex -= 1

        // And swap it with the current element.
        temporaryValue = array[currentIndex]
        array[currentIndex] = array[randomIndex]
        array[randomIndex] = temporaryValue
    }

    return array
}

exports.revokeActiveContracts = function(gameUuid) {
    models.Contract.update({
        status: 'REVOKED',
    }, {
        where: {
            gameUuid: gameUuid,
            status: 'ACTIVE'
        }
    })
    .then(result => {
        myLog.log('contractController: Succeed to revoke all active contracts associated with game: ' + gameUuid)
    })
    .catch(err => {
        myLog.error('contractController: Failed to revoke all active contracts associated with game: ' + gameUuid + '\n' + err)
    })
}

exports.sendContract = function(req, res) {
    models.Contract.findOne({
        where: {
            uuid: req.params.uuid
        }
    })
    .then(contract => {
        sendContractEmail(contract)
        myLog.error('contractController: Succeed to get and send contract.\n')
        res.render('info', {
            title: 'Contract send',
            message: 'Check your email spam box'
        })
    })
    .catch(err => {
        myLog.error('contractController: Failed to get and send contract.\n' + err)
        res.render('shitHappens')
    })
}

exports.sendAllActiveContracts = function(req, res) {
    models.Contract.findAll({
        where: {
            gameUuid: req.params.uuid,
            status: 'ACTIVE'
        }
    })
    .then(contracts => {
        contracts.forEach(function(contract) {
            sendContractEmail(contract)
        })
        res.render('info', {
            title: 'Contracts send',
            message: 'All contracts of game ' + req.params.uuid + ' were send'
        })
    })
    .catch(err => {
        myLog.error('contractController: Failed to get game.\n' + err)
        res.render('shitHappens')
    })
}

exports.createAndSendContract = function(gameUuid, killerUuid, victimUuid, challengeUuid) {
    var uuid = uuidv4()
    var nowISO8601 = new Date().toISOString().split('.')[0]+'Z'

    models.Contract.create({
        uuid: uuid,
        creationDate: nowISO8601,
        gameUuid: gameUuid,
        killerUuid: killerUuid,
        victimUuid: victimUuid,
        challengeUuid: challengeUuid,
        status: 'ACTIVE'
    })
    .then(contract => {
        sendContractEmail(contract)
    })
    .catch(err => {
        myLog.error('contractController: Failed to create contract.\n' + err)
    })
}

function sendContractEmail(contract) {
    var getGame = function(){
        return models.Game.findOne({
            where: {
                uuid: contract.gameUuid
            }
        })
        .catch(err => {
            myLog.error('contractController: Failed to retrieve game info.\n' + err)
        })
    }

    var getKiller = function(){
        return models.Player.findOne({
            where: {
                uuid: contract.killerUuid
            }
        })
        .catch(err => {
            myLog.error('contractController: Failed to retrieve killer info.\n' + err)
        })
    }

    var getVictim = function(){
        return models.Player.findOne({
            where: {
                uuid: contract.victimUuid
            }
        })
        .catch(err => {
            myLog.error('contractController: Failed to retrieve victim info.\n' + err)
        })
    }

    var getChallenge = function(){
        return models.Challenge.findOne({
            where: {
                uuid: contract.challengeUuid
            }
        })
        .catch(err => {
            myLog.error('contractController: Failed to retrieve challenge info.\n' + err)
        })
    }

    Promise.join(getGame(), getKiller(), getVictim(), getChallenge(), function(game, killer, victim, challenge){
        if (game && killer && victim && challenge) {
            // Create email message
            var attemptURL = baseURL + '/attempts?gameUuid=' + contract.gameUuid + '&playerUuid=' + contract.killerUuid + '&playerCode=' + killer.code
            var message = 'Bonjour ' + killer.firstName + ',\
            \n\nCe mail concerne la partie de killer \"' + game.name + '\".\
            \n\nPour remplir ton nouveau contrat tu vas devoir tuer ' + victim.firstName + ' ' + victim.lastName + ' en le/la faisant ' + challenge.description + '\
            \n\nUne fois que tu auras rempli ce contrat tu pourras le valider via ce lien:\
            \n' + attemptURL + '\
            \nPour le valider il te faudra ton code personnel (garde le secret): ' + killer.code + '\
            \nAinsi que le code personnel de ' + victim.firstName + ' ' + victim.lastName + ' (qu\'il faudra sélectionner dans la liste).\
            \nDonc ne revèle ton code personnel que si quelqu\'un te tue !\
            \n\nSee ya soon.'
            
            mailer.sendMail(killer.email, 'Vous avez un nouveau contrat', message)
            .then(function(info) {
                myLog.log('contractController: A contract email was sent to ' + killer.email)
            }).catch(function(err) {
                myLog.error('contractController: There was an issue while sending contract email to ' + killer.email + '\n' + err)
            })
        }
        else {
            myLog.error('contractController: Inconsistent data for game, killer, victim or challenge. Cannot create contract email.')
        }
    })
}

exports.fulfillContract = function(gameUuid, killerUuid, victimUuid, victimStatus) {
    // Get victim contract
    models.Contract.findOne({
        where : {
            gameUuid: gameUuid,
            killerUuid: victimUuid,
            status: 'ACTIVE'
        }
    })
    .then(contract => {
        // Update victim contract with the given status
        var updateVictimContract = function(){
            return models.Contract.update({
                status: victimStatus
            }, {
                where: {
                    uuid: contract.uuid
                }
            })
            .catch(err => {
                myLog.error('contractController: Failed to update victim contract (gameUuid: ' + gameUuid + ' , killerUuid: ' + victimUuid + ')\n' + err)
            })
        }

        // Update killer contract with fulfilled status
        var updateKillerContract = function(){
            return models.Contract.update({
                status: 'FULFILLED'
            }, {
                where: {
                    gameUuid: gameUuid,
                    killerUuid: killerUuid,
                    status: 'ACTIVE'
                }
            })
            .catch(err => {
                myLog.error('contractController: Failed to update killer contract (gameUuid: ' + gameUuid + ' , killerUuid: ' + killerUuid + ')\n' + err)
            })
        }

        Promise.join(updateVictimContract(), updateKillerContract(), function(victimResult, killerResult){
            if (victimResult == 1 && killerResult == 1) {
                // Check if game is finished
                if (killerUuid === contract.victimUuid) {
                    models.Player.findOne({
                        where: {
                            uuid: killerUuid
                        }
                    })
                    .then(player => {
                        var message = 'Congratulations ' + player.firstName + ',\
                        \n\nYou won the killer party !.\
                        \n\nSee ya soon.'

                        mailer.sendMail(player.email, 'You won the party !', message)
                    })
                    .catch(err => {
                        myLog.error('contractController: Failed to retrieve winner info.\n' + err)
                    })
                }
                else {
                    // Create a new contract between the killer and the victim's target
                    models.Challenge.findAll()
                    .then(challenges => {
                        var challengeRandomIndex = Math.floor(Math.random() * challenges.length)
                        var newChallengeUuid = challenges[challengeRandomIndex].uuid
                        exports.createAndSendContract(gameUuid, killerUuid, contract.victimUuid, newChallengeUuid)
                    })
                    .catch(err => {
                        myLog.error('contractController: Failed to get challenges for a new contract.\n' + err)
                    })
                }
            }
            else {
                myLog.error('contractController: Inconsistent number of updated contracts')
            }
        })
    })
    .catch(err => {
        myLog.error('contractController: Failed to get active contract (gameUuid: ' + gameUuid + ' , killerUuid: ' + victimUuid + ')\n' + err)
    })
}
