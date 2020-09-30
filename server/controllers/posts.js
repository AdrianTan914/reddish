const router = require('express').Router();
const Post = require('../models/post');
const Subreddit = require('../models/subreddit');
const User = require('../models/user');
const postTypeValidator = require('../utils/postTypeValidator');
const { auth } = require('../utils/middleware');
const { cloudinary } = require('../utils/config');
const paginateResults = require('../utils/paginateResults');

router.get('/new', async (req, res) => {
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);

  const postsCount = await Post.countDocuments();
  const paginated = paginateResults(page, limit, postsCount);

  const allPosts = await Post.find({})
    .sort({ createdAt: -1 })
    .select('-comments -textSubmission')
    .limit(limit)
    .skip(paginated.startIndex)
    .populate('author', 'username')
    .populate('subreddit', 'subredditName');

  const paginatedPosts = {
    previous: paginated.results.previous,
    results: allPosts,
    next: paginated.results.next,
  };

  res.status(200).json(paginatedPosts);
});

router.get('/:id/comments', async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id);

  if (!post) {
    return res
      .status(404)
      .send({ message: `Post with ID: '${id}' does not exist in database.` });
  }

  const populatedPost = await post
    .populate('comments.commentedBy', 'username')
    .populate('comments.replies.repliedBy', 'username')
    .execPopulate();

  res.status(200).json(populatedPost);
});

router.post('/', auth, async (req, res) => {
  const {
    title,
    subreddit,
    postType,
    textSubmission,
    linkSubmission,
    imageSubmission,
  } = req.body;

  const validatedFields = postTypeValidator(
    postType,
    textSubmission,
    linkSubmission,
    imageSubmission
  );

  const author = await User.findById(req.user);
  const targetSubreddit = await Subreddit.findById(subreddit);

  if (!author) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  if (!targetSubreddit) {
    return res.status(404).send({
      message: `Subreddit with ID: '${subreddit}' does not exist in database.`,
    });
  }

  const newPost = new Post({
    title,
    subreddit,
    author: author._id,
    upvotedBy: [author._id],
    pointsCount: 1,
    ...validatedFields,
  });

  if (postType === 'Image') {
    const uploadedImage = await cloudinary.uploader.upload(
      imageSubmission,
      {
        upload_preset: 'readify',
      },
      (error) => {
        if (error) return res.status(401).send({ message: error.message });
      }
    );

    newPost.imageSubmission = {
      imageLink: uploadedImage.url,
      imageId: uploadedImage.public_id,
    };
  }

  const savedPost = await newPost.save();

  targetSubreddit.posts = targetSubreddit.posts.concat(savedPost._id);
  await targetSubreddit.save();

  author.posts = author.posts.concat(savedPost._id);
  author.karmaPoints.postKarma++;
  await author.save();

  const populatedPost = await savedPost
    .populate('author', 'username')
    .populate('subreddit', 'subredditName')
    .execPopulate();

  res.status(201).json(populatedPost);
});

router.patch('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const { textSubmission, linkSubmission, imageSubmission } = req.body;

  const post = await Post.findById(id);
  const author = await User.findById(req.user);

  if (!post) {
    return res.status(404).send({
      message: `Post with ID: ${id} does not exist in database.`,
    });
  }

  if (!author) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  if (post.author.toString() !== author._id.toString()) {
    return res.status(401).send({ message: 'Access is denied.' });
  }

  const validatedFields = postTypeValidator(
    post.postType,
    textSubmission,
    linkSubmission,
    imageSubmission
  );

  switch (post.postType) {
    case 'Text':
      post.textSubmission = validatedFields.textSubmission;
      break;

    case 'Link':
      post.linkSubmission = validatedFields.linkSubmission;
      break;

    case 'Image':
      const uploadedImage = await cloudinary.uploader.upload(
        imageSubmission,
        {
          upload_preset: 'readify',
        },
        (error) => {
          if (error) return res.status(401).send({ message: error.message });
        }
      );

      post.imageSubmission = {
        imageLink: uploadedImage.url,
        imageId: uploadedImage.public_id,
      };
      break;

    default:
      return res.status(403).send({ message: 'Invalid post type.' });
  }

  post.updatedAt = Date.now;

  await post.save();
  res.status(202).json(post);
});

router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id);
  const author = await User.findById(req.user);

  if (!post) {
    return res.status(404).send({
      message: `Post with ID: ${id} does not exist in database.`,
    });
  }

  if (!author) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  if (post.author.toString() !== author._id.toString()) {
    return res.status(401).send({ message: 'Access is denied.' });
  }

  const subreddit = await Subreddit.findById(post.subreddit);

  if (!subreddit) {
    return res.status(404).send({
      message: `Subreddit with ID: '${subreddit._id}'  does not exist in database.`,
    });
  }

  await Post.findByIdAndDelete(id);

  subreddit.posts = subreddit.posts.filter((p) => p.toString() !== id);
  await subreddit.save();

  author.posts = author.posts.filter((p) => p.toString() !== id);
  await author.save();

  res.status(204).end();
});

module.exports = router;
