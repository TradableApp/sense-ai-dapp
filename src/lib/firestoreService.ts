import { Timestamp } from 'firebase/firestore';

import { isObject } from './utils';

function formatArrayDates(arr) {
	return arr.map(el => {
		if (el instanceof Timestamp) {
			return el.toDate();
		}
		if (isObject(el)) {
			// eslint-disable-next-line no-use-before-define
			return formatObjectDates(el);
		}
		if (Array.isArray(el)) {
			return formatArrayDates(el);
		}
		return el;
	});
}

export function formatObjectDates(obj) {
	const newObj = {};
	const keys = Object.keys(obj);
	keys.forEach(key => {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			if (obj[key] instanceof Timestamp) {
				// console.log('Changing date', obj[key], obj[key].toDate());
				newObj[key] = obj[key].toDate();
			} else if (
				typeof obj[key] === 'string' &&
				obj[key].match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?$/i)
			) {
				// console.log('Changing date', obj[key], new Date(obj[key]));
				newObj[key] = new Date(obj[key]);
			} else if (isObject(obj[key])) {
				if (
					Object.prototype.hasOwnProperty.call(obj[key], '_seconds') &&
					Object.prototype.hasOwnProperty.call(obj[key], '_nanoseconds')
				) {
					newObj[key] = new Date(
						// eslint-disable-next-line no-underscore-dangle
						obj[key]._seconds * 1000 + Math.round(obj[key]._nanoseconds / 1000000),
					);
				} else {
					newObj[key] = formatObjectDates(obj[key]);
				}
			} else if (Array.isArray(obj[key])) {
				newObj[key] = formatArrayDates(obj[key]);
			} else {
				newObj[key] = obj[key];
			}
		}
	});

	return newObj;
}

export const dataFromSnapshot = (snapshot, id) => {
	if (!snapshot.exists()) return undefined;
	const data = snapshot.data();

	if (data === undefined) return {};

	// Loop through each field in the data to check if it's a timestamp and if so use it's toDate method to change it into a date
	const formatedData = formatObjectDates(data);

	// Return the data along with it's id field (if no id set it to it's document id)
	if (id === '') {
		return formatedData;
	}

	return { [id || 'id']: snapshot.id, ...formatedData };
};

export const dataFromReqBody = body => {
	// Loop through each field in the body to check if it's a timestamp, and if so, change it into a date
	const formatedBody = formatObjectDates(body);

	return formatedBody;
};
