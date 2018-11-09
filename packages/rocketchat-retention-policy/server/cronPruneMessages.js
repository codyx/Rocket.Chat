/* globals SyncedCron */

let types = [];
let userDeletion = false;

const oldest = new Date('0001-01-01T00:00:00Z');

let lastPrune = oldest;

const maxTimes = {
	c: 0,
	p: 0,
	d: 0,
	u: 0,
};
const toDays = 1000 * 60 * 60 * 24;
const gracePeriod = 5000;
function job() {
	const now = new Date();
	const filesOnly = RocketChat.settings.get('RetentionPolicy_FilesOnly');
	const excludePinned = RocketChat.settings.get('RetentionPolicy_ExcludePinned');

	// get all rooms with default values
	types.forEach((type) => {
		const maxAge = maxTimes[type] || 0;
		const latest = new Date(now.getTime() - maxAge * toDays);

		RocketChat.models.Rooms.find({
			t: type,
			_updatedAt: { $gte: lastPrune },
			$or: [{ 'retention.enabled': { $eq: true } }, { 'retention.enabled': { $exists: false } }],
			'retention.overrideGlobal': { $ne: true },
		}).forEach(({ _id: rid }) => {
			RocketChat.cleanRoomHistory({ rid, latest, oldest, filesOnly, excludePinned });
		});
	});

	RocketChat.models.Rooms.find({
		'retention.enabled': { $eq: true },
		'retention.overrideGlobal': { $eq: true },
		'retention.maxAge': { $gte: 0 },
		_updatedAt: { $gte: lastPrune },
	}).forEach((room) => {
		const { maxAge = 30, filesOnly, excludePinned } = room.retention;
		const latest = new Date(now.getTime() - maxAge * toDays);
		RocketChat.cleanRoomHistory({ rid: room._id, latest, oldest, filesOnly, excludePinned });
	});

	if (userDeletion) {
		const maxAge = maxTimes.u || 730;
		const lastLoginAllowed = new Date(now.getTime() - maxAge * toDays);

		RocketChat.models.Users.find({
			lastLogin: { $lt: lastLoginAllowed },
		}).forEach((user) => {
			RocketChat.deleteUser(user._id);
		});
	}

	lastPrune = new Date(now.getTime() - gracePeriod);
}

function getSchedule(precision) {
	switch (precision) {
		case '0':
			return '0 */30 * * * *';
		case '1':
			return '0 0 * * * *';
		case '2':
			return '0 0 */6 * * *';
		case '3':
			return '0 0 0 * * *';
	}
}

const pruneCronName = 'Prune old messages by retention policy';

function deployCron(precision) {
	const schedule = (parser) => parser.cron(getSchedule(precision), true);

	SyncedCron.remove(pruneCronName);
	SyncedCron.add({
		name: pruneCronName,
		schedule,
		job,
	});
}

function reloadPolicy() {
	types = [];

	if (RocketChat.settings.get('RetentionPolicy_Enabled')) {
		if (RocketChat.settings.get('RetentionPolicy_AppliesToChannels')) {
			types.push('c');
		}

		if (RocketChat.settings.get('RetentionPolicy_AppliesToGroups')) {
			types.push('p');
		}

		if (RocketChat.settings.get('RetentionPolicy_AppliesToDMs')) {
			types.push('d');
		}

		if (RocketChat.settings.get('RetentionPolicy_Enable_Users_Inactivity')) {
			userDeletion = true;
		}

		maxTimes.c = RocketChat.settings.get('RetentionPolicy_MaxAge_Channels');
		maxTimes.p = RocketChat.settings.get('RetentionPolicy_MaxAge_Groups');
		maxTimes.d = RocketChat.settings.get('RetentionPolicy_MaxAge_DMs');
		maxTimes.u = RocketChat.settings.get('RetentionPolicy_MaxAge_Users_Inactivity');

		return deployCron(RocketChat.settings.get('RetentionPolicy_Precision'));
	}
	return SyncedCron.remove(pruneCronName);
}

Meteor.startup(function() {
	Meteor.defer(function() {
		RocketChat.models.Settings.find({
			_id: {
				$in: [
					'RetentionPolicy_Enabled',
					'RetentionPolicy_Precision',
					'RetentionPolicy_AppliesToChannels',
					'RetentionPolicy_AppliesToGroups',
					'RetentionPolicy_AppliesToDMs',
					'RetentionPolicy_MaxAge_Channels',
					'RetentionPolicy_MaxAge_Groups',
					'RetentionPolicy_MaxAge_DMs',
					'RetentionPolicy_Enable_Users_Inactivity',
					'RetentionPolicy_MaxAge_Users_Inactivity',
				],
			},
		}).observe({
			changed() {
				reloadPolicy();
			},
		});

		reloadPolicy();
	});
});
