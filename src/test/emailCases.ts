/** Addresses the contact forms accept today; a validator change must keep accepting them. */
export const ACCEPTED_EMAILS = [
	'user@example.com',
	'first.last+tag@sub.example.co',
	"o'brien@example.org",
	'USER_1-x@EXAMPLE.COM',
];

/** Addresses the contact forms refuse today. */
export const REFUSED_EMAILS = [
	'not-an-email',
	'.user@example.com',
	'us..er@example.com',
	'user.@example.com',
	'user@example',
	'user@-example.com',
	'user@example.c',
	'user name@example.com',
	'user@exa_mple.com',
];
